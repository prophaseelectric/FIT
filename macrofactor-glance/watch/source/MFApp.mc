import Toybox.Application;
import Toybox.Background;
import Toybox.Lang;
import Toybox.Time;
import Toybox.WatchUi;

// Annotated for background + glance so onBackgroundData runs in either process.
// Foreground-only symbols referenced below are never called from those contexts.
(:background :glance)
class MFApp extends Application.AppBase {

    function initialize() {
        AppBase.initialize();
    }

    (:typecheck(false))
    function registerBg() as Void {
        // 15 min is the brief's cadence; CIQ minimum is 5 min.
        if (Background.getTemporalEventRegisteredTime() == null) {
            Background.registerForTemporalEvent(new Time.Duration(15 * 60));
        }
    }

    function getInitialView() {
        registerBg();
        var v = new MFPagesView();
        return [v, new MFPagesDelegate(v)];
    }

    (:glance)
    function getGlanceView() {
        registerBg();
        return [new MFGlanceView()];
    }

    function getServiceDelegate() {
        return [new MFServiceDelegate()];
    }

    // Background.exit() payload lands here: a state Dictionary or a Number error code.
    function onBackgroundData(data) as Void {
        MFStore.ingest(data);
        MFComplications.publish();
        WatchUi.requestUpdate();
    }
}
