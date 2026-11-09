import Toybox.Lang;

// Publishes kcal_remaining (id 0) and protein_remaining (id 1) for watch faces.
// No-ops if the firmware lacks the Complications publisher API, so the app still runs.
(:glance)
module MFComplications {
    (:typecheck(false))
    function publish() as Void {
        if (!(Toybox has :Complications) || !(Toybox.Complications has :updateComplication)) {
            return;
        }
        var s = MFStore.state();
        if (s == null) { return; }
        try {
            Toybox.Complications.updateComplication(0, {
                :value => MFData.left(s, "kcal"), :shortLabel => "KCAL", :units => "kcal"
            });
            Toybox.Complications.updateComplication(1, {
                :value => MFData.left(s, "p"), :shortLabel => "PROT", :units => "g"
            });
        } catch (e) {
            // Unsupported in this process (e.g. glance) or older firmware.
        }
    }
}
