import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Time;
import Toybox.WatchUi;

const MF_PAGES = 4;
const MF_LOG_PAGE = 3;

// Full widget: Today, Weight, Adherence, Log. Up/Down cycles, START acts.
class MFPagesView extends WatchUi.View {
    const FRESH_SECS = 10 * 60;

    var page = 0;
    var _busy = false;

    function initialize() {
        View.initialize();
    }

    function onShow() as Void {
        if (Time.now().value() - MFStore.fetchedAt() > FRESH_SECS) {
            refresh();
        }
    }

    function refresh() as Void {
        if (_busy) { return; }
        _busy = true;
        MFNet.fetch(method(:onFetch));
        WatchUi.requestUpdate();
    }

    function onFetch(code as Number, data) as Void {
        _busy = false;
        MFStore.ingest((code == 200 && data instanceof Dictionary) ? data : code);
        MFComplications.publish();
        WatchUi.requestUpdate();
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();
        var s = MFStore.state();
        if (s == null) {
            center(dc, dc.getHeight() / 2, Graphics.FONT_SMALL,
                _busy ? "loading..." : MFStore.errText(MFStore.errCode()), Graphics.COLOR_LT_GRAY);
            return;
        }
        if (page == 0) { drawToday(dc, s); }
        else if (page == 1) { drawWeight(dc, s); }
        else if (page == 2) { drawAdherence(dc, s); }
        else { drawLog(dc); }
        drawFooter(dc, s);
        drawDots(dc);
    }

    // ---- helpers ----

    function center(dc as Graphics.Dc, y as Number, font, txt as String, color as Number) as Void {
        dc.setColor(color, Graphics.COLOR_TRANSPARENT);
        dc.drawText(dc.getWidth() / 2, y, font, txt, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    function title(dc as Graphics.Dc, txt as String) as Void {
        center(dc, dc.getHeight() * 13 / 100, Graphics.FONT_XTINY, txt, Graphics.COLOR_LT_GRAY);
    }

    function rowY(dc as Graphics.Dc, i as Number) as Number {
        return dc.getHeight() * 25 / 100 + i * (dc.getFontHeight(Graphics.FONT_SMALL) * 105 / 100);
    }

    function drawFooter(dc as Graphics.Dc, s) as Void {
        var err = MFStore.errCode();
        var y = dc.getHeight() * 88 / 100;
        if (MFStore.isSizeError(err)) {
            center(dc, y, Graphics.FONT_XTINY, "BLOB TOO BIG", Graphics.COLOR_RED);
        } else if (_busy) {
            center(dc, y, Graphics.FONT_XTINY, "refreshing", Graphics.COLOR_LT_GRAY);
        } else if (MFData.isStale(s)) {
            center(dc, y, Graphics.FONT_XTINY, "stale" + (err != null ? " | " + MFStore.errText(err) : ""),
                Graphics.COLOR_ORANGE);
        } else {
            var u = MFData.str(s.get("updated"));
            center(dc, y, Graphics.FONT_XTINY, u.length() >= 16 ? "upd " + u.substring(11, 16) : "",
                Graphics.COLOR_DK_GRAY);
        }
    }

    function drawDots(dc as Graphics.Dc) as Void {
        var y = dc.getHeight() * 95 / 100;
        var cx = dc.getWidth() / 2;
        for (var i = 0; i < MF_PAGES; i++) {
            dc.setColor(i == page ? Graphics.COLOR_WHITE : Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.fillCircle(cx + (2 * i - (MF_PAGES - 1)) * 6, y, 3);
        }
    }

    // ---- pages ----

    function drawToday(dc as Graphics.Dc, s) as Void {
        title(dc, "TODAY");
        var stale = MFData.isStale(s);
        var fg = stale ? Graphics.COLOR_LT_GRAY : Graphics.COLOR_WHITE;
        var keys = ["kcal", "p", "c", "f"];
        var names = ["Cal", "Pro", "Carb", "Fat"];
        var w = dc.getWidth();
        for (var i = 0; i < 4; i++) {
            var k = keys[i];
            var c = MFData.consumed(s, k);
            var t = MFData.target(s, k);
            var over = c > t;
            var y = rowY(dc, i);
            center(dc, y, Graphics.FONT_SMALL, names[i] + " " + c + " / " + t,
                (over && !stale) ? Graphics.COLOR_RED : fg);
            MFData.bar(dc, w * 25 / 100, y + dc.getFontHeight(Graphics.FONT_SMALL) / 2, w / 2, 3, c, t,
                k.equals("kcal") ? Graphics.COLOR_WHITE : MFData.macroColor(k), stale);
        }
        var ml = MFData.isToday(s) ? MFData.num(s.get("water_ml")) : 0;
        center(dc, rowY(dc, 4), Graphics.FONT_SMALL, "Water " + (ml / 1000.0).format("%.2f") + " L", 0x55C8FF);
    }

    function drawWeight(dc as Graphics.Dc, s) as Void {
        title(dc, "WEIGHT");
        var wt = MFData.dict(s, "weight");
        var scale = MFData.numF(wt.get("scale"));
        var trend = MFData.numF(wt.get("trend"));
        var goal = MFData.numF(wt.get("goal"));
        var sd = MFData.str(wt.get("scale_date"));
        var toGo = trend - goal;
        var f = Graphics.FONT_SMALL;
        var c = Graphics.COLOR_WHITE;
        center(dc, rowY(dc, 0), f, "Scale " + scale.format("%.1f") + (sd.length() >= 10 ? " (" + sd.substring(5, 10) + ")" : ""), c);
        center(dc, rowY(dc, 1), f, "Trend " + trend.format("%.2f"), c);
        center(dc, rowY(dc, 2), f, "TDEE " + MFData.num(wt.get("expenditure")), c);
        center(dc, rowY(dc, 3), f, "Goal " + goal.format("%.1f") + " | " + toGo.format("%.1f") + " to go", c);
        center(dc, rowY(dc, 4), f, "ETA " + MFData.str(wt.get("eta")), Graphics.COLOR_LT_GRAY);
    }

    function drawAdherence(dc as Graphics.Dc, s) as Void {
        title(dc, "LAST 7 DAYS");
        var week = s.get("week");
        if (!(week instanceof Array) || week.size() == 0) {
            center(dc, dc.getHeight() / 2, Graphics.FONT_SMALL, "no history", Graphics.COLOR_LT_GRAY);
            return;
        }
        var tgt = MFData.target(s, "kcal");
        var n = week.size();
        var maxK = tgt * 13 / 10;
        for (var i = 0; i < n; i++) {
            var k = MFData.num(week[i].get("kcal"));
            if (k > maxK) { maxK = k; }
        }
        if (maxK <= 0) { maxK = 1; }

        var w = dc.getWidth();
        var h = dc.getHeight();
        var left = w * 20 / 100;
        var span = w * 60 / 100;
        var top = h * 22 / 100;
        var base = h * 58 / 100;
        var colW = span / n;
        var bw = colW * 6 / 10;
        var sumP = 0; var sumC = 0; var sumF = 0;

        for (var i = 0; i < n; i++) {
            var d = week[i];
            var k = MFData.num(d.get("kcal"));
            sumP += MFData.num(d.get("p"));
            sumC += MFData.num(d.get("c"));
            sumF += MFData.num(d.get("f"));
            var bh = (base - top) * k / maxK;
            var color = Graphics.COLOR_GREEN;                 // within +/-5% = on
            if (tgt > 0 && k * 100 > tgt * 105) { color = Graphics.COLOR_RED; }
            else if (tgt > 0 && k * 100 < tgt * 95) { color = 0x3C8CFF; }
            var x = left + i * colW + (colW - bw) / 2;
            dc.setColor(color, Graphics.COLOR_TRANSPARENT);
            dc.fillRectangle(x, base - bh, bw, bh);
            var lbl = MFData.str(d.get("d"));
            dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(x + bw / 2, base + 2, Graphics.FONT_XTINY,
                lbl.length() >= 5 ? lbl.substring(3, 5) : lbl, Graphics.TEXT_JUSTIFY_CENTER);
        }
        // target line
        var ty = base - (base - top) * tgt / maxK;
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawLine(left, ty, left + span, ty);

        var f = Graphics.FONT_XTINY;
        var y0 = h * 72 / 100;
        center(dc, y0, f, "avg P " + (sumP / n) + "/" + MFData.target(s, "p")
            + "  C " + (sumC / n) + "/" + MFData.target(s, "c")
            + "  F " + (sumF / n) + "/" + MFData.target(s, "f"), Graphics.COLOR_WHITE);
    }

    function drawLog(dc as Graphics.Dc) as Void {
        title(dc, "LOG");
        center(dc, dc.getHeight() * 45 / 100, Graphics.FONT_SMALL, "Water / staples", Graphics.COLOR_WHITE);
        center(dc, dc.getHeight() * 60 / 100, Graphics.FONT_XTINY, "press START", Graphics.COLOR_LT_GRAY);
    }
}

class MFPagesDelegate extends WatchUi.BehaviorDelegate {
    var _v as MFPagesView;

    function initialize(v as MFPagesView) {
        BehaviorDelegate.initialize();
        _v = v;
    }

    function onNextPage() as Boolean {
        _v.page = (_v.page + 1) % MF_PAGES;
        WatchUi.requestUpdate();
        return true;
    }

    function onPreviousPage() as Boolean {
        _v.page = (_v.page + MF_PAGES - 1) % MF_PAGES;
        WatchUi.requestUpdate();
        return true;
    }

    // START: open the log menu on the Log page, otherwise force a refresh.
    function onSelect() as Boolean {
        if (_v.page == MF_LOG_PAGE) {
            MFLog.openMenu();
        } else {
            _v.refresh();
        }
        return true;
    }
}
