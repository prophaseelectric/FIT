import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

// Glance: big "kcal left", then three thin P / C / F bars with grams remaining.
(:glance)
class MFGlanceView extends WatchUi.GlanceView {

    function initialize() {
        GlanceView.initialize();
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        var w = dc.getWidth();
        var h = dc.getHeight();
        var s = MFStore.state();
        var err = MFStore.errCode();
        dc.setColor(Graphics.COLOR_TRANSPARENT, Graphics.COLOR_BLACK);
        dc.clear();

        if (s == null) {
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(0, h / 2, Graphics.FONT_GLANCE, "MACROFACTOR",
                Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
            dc.setColor(MFStore.isSizeError(err) ? Graphics.COLOR_RED : Graphics.COLOR_LT_GRAY,
                Graphics.COLOR_TRANSPARENT);
            dc.drawText(0, h - 2, Graphics.FONT_XTINY, MFStore.errText(err),
                Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
            return;
        }

        var stale = MFData.isStale(s);
        var fg = stale ? Graphics.COLOR_LT_GRAY : Graphics.COLOR_WHITE;

        // Row 1: kcal remaining
        var kl = MFData.left(s, "kcal");
        var big = MFData.leftText(s, "kcal");
        var fBig = Graphics.FONT_GLANCE_NUMBER;
        var fSm = Graphics.FONT_GLANCE;
        var y1 = h * 30 / 100;
        dc.setColor((kl < 0 && !stale) ? Graphics.COLOR_RED : fg, Graphics.COLOR_TRANSPARENT);
        dc.drawText(0, y1, fBig, big, Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
        var x = dc.getTextWidthInPixels(big, fBig) + 4;
        var suffix = (kl < 0) ? "kcal over" : "kcal left";
        if (MFStore.isSizeError(err)) {
            dc.setColor(Graphics.COLOR_RED, Graphics.COLOR_TRANSPARENT);
            suffix = "BLOB TOO BIG";
        } else {
            dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
            if (stale) { suffix += " | stale"; }
        }
        dc.drawText(x, y1, fSm, suffix, Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);

        // Row 2: P / C / F labels + bars, side by side
        var keys = ["p", "c", "f"];
        var names = ["P ", "C ", "F "];
        var gap = 6;
        var bw = (w - 2 * gap) / 3;
        var yLabel = h * 66 / 100;
        var yBar = h - 6;
        for (var i = 0; i < 3; i++) {
            var k = keys[i];
            var bx = i * (bw + gap);
            var over = MFData.left(s, k) < 0;
            dc.setColor((over && !stale) ? Graphics.COLOR_RED : fg, Graphics.COLOR_TRANSPARENT);
            dc.drawText(bx, yLabel, Graphics.FONT_XTINY, names[i] + MFData.leftText(s, k),
                Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
            MFData.bar(dc, bx, yBar, bw, 4, MFData.consumed(s, k), MFData.target(s, k),
                MFData.macroColor(k), stale);
        }
    }
}
