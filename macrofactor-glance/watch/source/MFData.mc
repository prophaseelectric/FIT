import Toybox.Graphics;
import Toybox.Lang;
import Toybox.System;
import Toybox.Time;
import Toybox.Time.Gregorian;

// Pure helpers over the state dictionary. Tolerant of Shortcuts sending numbers as
// strings, missing keys, and yesterday's blob after midnight.
(:glance)
module MFData {
    const STALE_SECS = 3 * 3600;

    function num(v) as Number {
        if (v instanceof Number) { return v; }
        if (v instanceof Float || v instanceof Double || v instanceof Long) { return v.toNumber(); }
        if (v instanceof String) {
            var f = v.toFloat();
            return (f == null) ? 0 : f.toNumber();
        }
        return 0;
    }

    function numF(v) as Float {
        if (v instanceof Float) { return v; }
        if (v instanceof Number || v instanceof Double || v instanceof Long) { return v.toFloat(); }
        if (v instanceof String) {
            var f = v.toFloat();
            return (f == null) ? 0.0 : f;
        }
        return 0.0;
    }

    function dict(s, k as String) as Dictionary {
        if (s instanceof Dictionary) {
            var v = s.get(k);
            if (v instanceof Dictionary) { return v; }
        }
        return {};
    }

    function str(v) as String {
        return (v instanceof String) ? v : "";
    }

    function todayStr() as String {
        var i = Gregorian.info(Time.now(), Time.FORMAT_SHORT);
        return i.year.format("%04d") + "-" + (i.month as Number).format("%02d") + "-" + i.day.format("%02d");
    }

    function isToday(s) as Boolean {
        return str(s.get("date")).equals(todayStr());
    }

    // "2026-11-09T14:05:00-08:00" -> epoch seconds (UTC). null if unparseable.
    function parseIso(t) {
        if (!(t instanceof String) || t.length() < 19) { return null; }
        var y = t.substring(0, 4).toNumberWithBase(10);
        var mo = t.substring(5, 7).toNumberWithBase(10);
        var d = t.substring(8, 10).toNumberWithBase(10);
        var h = t.substring(11, 13).toNumberWithBase(10);
        var mi = t.substring(14, 16).toNumberWithBase(10);
        var se = t.substring(17, 19).toNumberWithBase(10);
        if (y == null || mo == null || d == null || h == null || mi == null || se == null) { return null; }
        // Gregorian.moment() takes UTC fields.
        var m = Gregorian.moment({:year => y, :month => mo, :day => d, :hour => h, :minute => mi, :second => se});
        var off;
        if (t.length() >= 25) {
            var oh = t.substring(20, 22).toNumberWithBase(10);
            var om = t.substring(23, 25).toNumberWithBase(10);
            off = ((oh == null ? 0 : oh) * 3600) + ((om == null ? 0 : om) * 60);
            if (t.substring(19, 20).equals("-")) { off = -off; }
        } else if (t.length() >= 20 && t.substring(19, 20).equals("Z")) {
            off = 0;
        } else {
            off = System.getClockTime().timeZoneOffset;
        }
        return m.value() - off;
    }

    function isStale(s) as Boolean {
        if (!isToday(s)) { return true; }
        var u = parseIso(s.get("updated"));
        return u == null || (Time.now().value() - u) > STALE_SECS;
    }

    function target(s, k as String) as Number {
        return num(dict(s, "targets").get(k));
    }

    // After midnight the blob still holds yesterday until the first push: treat as 0 eaten.
    function consumed(s, k as String) as Number {
        return isToday(s) ? num(dict(s, "consumed").get(k)) : 0;
    }

    function left(s, k as String) as Number {
        return target(s, k) - consumed(s, k);
    }

    // "66" when under, "+12" when over.
    function leftText(s, k as String) as String {
        var l = left(s, k);
        return (l >= 0) ? l.toString() : "+" + (-l).toString();
    }

    function macroColor(k as String) as Number {
        if (k.equals("p")) { return 0x3C8CFF; }
        if (k.equals("c")) { return 0xFF9628; }
        if (k.equals("f")) { return 0xFFD200; }
        return Graphics.COLOR_WHITE;
    }

    // Horizontal progress bar. Red when over target, grey when stale.
    function bar(dc as Graphics.Dc, x as Number, y as Number, w as Number, h as Number,
                 eaten as Number, tgt as Number, color as Number, stale as Boolean) as Void {
        dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.fillRectangle(x, y, w, h);
        if (tgt <= 0) { return; }
        var over = eaten > tgt;
        var frac = over ? 1.0 : eaten.toFloat() / tgt;
        var c = stale ? Graphics.COLOR_LT_GRAY : (over ? Graphics.COLOR_RED : color);
        dc.setColor(c, Graphics.COLOR_TRANSPARENT);
        dc.fillRectangle(x, y, (w * frac).toNumber(), h);
    }
}
