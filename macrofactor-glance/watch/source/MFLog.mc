import Toybox.Application;
import Toybox.Communications;
import Toybox.Lang;
import Toybox.WatchUi;

// Write-back (Phase 4): POST to the Pushcut "MF Log" webhook. Pushcut passes `input`
// to the "MF Log" Shortcut, which calls MacroFactor's own Log Water / Log by JSON.
module MFLog {
    var _sender = null;

    function openMenu() as Void {
        var m = new WatchUi.Menu2({:title => "Log"});
        m.addItem(new WatchUi.MenuItem("Water 250 ml", null, "w250", {}));
        m.addItem(new WatchUi.MenuItem("Water 500 ml", null, "w500", {}));
        var s = MFStore.state();
        var staples = (s instanceof Dictionary) ? s.get("staples") : null;
        if (staples instanceof Array) {
            for (var i = 0; i < staples.size(); i++) {
                var st = staples[i];
                if (st instanceof Dictionary && st.get("id") instanceof String) {
                    m.addItem(new WatchUi.MenuItem(MFData.str(st.get("name")),
                        MFData.num(st.get("kcal")) + " kcal  P" + MFData.num(st.get("p")),
                        "s:" + st.get("id"), {}));
                }
            }
        }
        WatchUi.pushView(m, new MFLogMenuDelegate(), WatchUi.SLIDE_LEFT);
    }

    function findStaple(id as String) {
        var s = MFStore.state();
        var staples = (s instanceof Dictionary) ? s.get("staples") : null;
        if (staples instanceof Array) {
            for (var i = 0; i < staples.size(); i++) {
                if (MFData.str(staples[i].get("id")).equals(id)) { return staples[i]; }
            }
        }
        return null;
    }

    function toast(msg as String) as Void {
        if (WatchUi has :showToast) {
            WatchUi.showToast(msg, null);
        }
    }

    function send(id as String) as Void {
        var url = Application.Properties.getValue("pushcutUrl");
        if (!(url instanceof String) || url.length() < 20) {
            toast("Set Pushcut URL");
            return;
        }
        var input;
        var label;
        if (id.equals("w250") || id.equals("w500")) {
            var ml = id.equals("w250") ? 250 : 500;
            input = "{\"action\":\"water\",\"ml\":" + ml + "}";
            label = "Water " + ml + " ml";
        } else {
            var sid = id.substring(2, id.length());
            var st = findStaple(sid);
            if (st == null) { toast("Unknown staple"); return; }
            input = "{\"action\":\"food\",\"id\":\"" + sid + "\"}";
            label = MFData.str(st.get("name"));
        }
        _sender = new MFLogSender(id);
        Communications.makeWebRequest(url,
            {"title" => "MF Log", "text" => label, "input" => input},
            {
                :method => Communications.HTTP_REQUEST_METHOD_POST,
                :headers => {"Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON},
                :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
            },
            _sender.method(:onResponse));
    }

    // Optimistic local bump so the glance moves before the next blob refresh.
    function bump(id as String) as Void {
        var s = MFStore.state();
        if (!(s instanceof Dictionary) || !MFData.isToday(s)) { return; }
        if (id.equals("w250") || id.equals("w500")) {
            s.put("water_ml", MFData.num(s.get("water_ml")) + (id.equals("w250") ? 250 : 500));
        } else {
            var st = findStaple(id.substring(2, id.length()));
            if (st == null) { return; }
            var c = MFData.dict(s, "consumed");
            var keys = ["kcal", "p", "c", "f"];
            for (var i = 0; i < keys.size(); i++) {
                c.put(keys[i], MFData.num(c.get(keys[i])) + MFData.num(st.get(keys[i])));
            }
            s.put("consumed", c);
        }
        MFStore.saveState(s);
        MFComplications.publish();
    }
}

class MFLogSender {
    var _id as String;

    function initialize(id as String) {
        _id = id;
    }

    function onResponse(code as Number, data) as Void {
        if (code >= 200 && code < 300) {
            MFLog.bump(_id);
            MFLog.toast("Sent");
        } else {
            MFLog.toast("Failed " + code);
        }
        WatchUi.requestUpdate();
    }
}

class MFLogMenuDelegate extends WatchUi.Menu2InputDelegate {
    function initialize() {
        Menu2InputDelegate.initialize();
    }

    function onSelect(item as WatchUi.MenuItem) as Void {
        var id = item.getId();
        WatchUi.popView(WatchUi.SLIDE_RIGHT);
        if (id instanceof String) {
            MFLog.send(id);
        }
    }
}
