import Toybox.Application;
import Toybox.Lang;
import Toybox.Time;

// Cached state + last error. Keeps an in-memory copy because some firmware treats
// Storage as read-only inside the glance process; writes are best effort there.
(:glance)
module MFStore {
    var _state = null;
    var _err = null;
    var _loaded = false;

    function load() as Void {
        if (!_loaded) {
            _state = Application.Storage.getValue("state");
            _err = Application.Storage.getValue("err");
            _loaded = true;
        }
    }

    function state() {
        load();
        return _state;
    }

    function errCode() {
        load();
        return _err;
    }

    function fetchedAt() as Number {
        var t = Application.Storage.getValue("fetched");
        return (t instanceof Number) ? t : 0;
    }

    function ingest(data) as Void {
        load();
        if (data instanceof Dictionary && data.hasKey("consumed")) {
            _state = data;
            _err = null;
            put("state", data);
            put("fetched", Time.now().value());
        } else if (data instanceof Number) {
            _err = data;
        }
        put("err", _err);
    }

    // Used by the Log page's optimistic bump. Does not touch "fetched".
    function saveState(s as Dictionary) as Void {
        _state = s;
        put("state", s);
    }

    function put(k as String, v) as Void {
        try {
            Application.Storage.setValue(k, v);
        } catch (e) {
            // read-only in this context; in-memory copy still renders
        }
    }

    // Human text for an error code. -402 and -1000 are the "blob too big" guard.
    function errText(code) as String {
        if (code == null) { return "no data"; }
        if (code == -1001) { return "set Blob URL"; }
        if (code == -402 || code == -1000) { return "BLOB TOO BIG"; }
        if (code == -400) { return "bad JSON/type"; }
        if (code == 404) { return "no data (404)"; }
        if (code == 403) { return "SAS expired?"; }
        if (code == -104 || code == -2 || code == -300) { return "no phone"; }
        return "err " + code;
    }

    function isSizeError(code) as Boolean {
        return code == -402 || code == -1000;
    }
}
