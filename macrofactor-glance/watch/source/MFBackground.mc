import Toybox.Application;
import Toybox.Background;
import Toybox.Communications;
import Toybox.Lang;
import Toybox.System;

// Background code: keep tiny. Background memory on fenix is ~32 KB and the
// exit payload is capped (~8 KB), which is why state.json must stay < 6 KB.

(:background)
module MFNet {
    const ERR_NO_URL = -1001;

    function fetch(cb as Method) as Void {
        var url = Application.Properties.getValue("blobUrl");
        if (!(url instanceof String) || url.length() < 20) {
            cb.invoke(ERR_NO_URL, null);
            return;
        }
        Communications.makeWebRequest(url, null, {
            :method => Communications.HTTP_REQUEST_METHOD_GET,
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
        }, cb);
    }
}

(:background)
class MFServiceDelegate extends System.ServiceDelegate {
    const ERR_EXIT_TOO_BIG = -1000;

    function initialize() {
        ServiceDelegate.initialize();
    }

    function onTemporalEvent() as Void {
        MFNet.fetch(method(:onDone));
    }

    function onDone(code as Number, data) as Void {
        var out = (code == 200 && data instanceof Dictionary) ? data : code;
        try {
            Background.exit(out);
        } catch (e instanceof Background.ExitDataSizeLimitException) {
            Background.exit(ERR_EXIT_TOO_BIG);
        }
    }
}
