package PlaywrightUIPageload;

import org.json.JSONObject;

/** Playwright navigation timing captured in a single page visit. */
public final class NavMeasurement {

    final String elementLoadTime;
    final JSONObject timing;
    final boolean navigationOk;

    NavMeasurement(String elementLoadTime, JSONObject timing, boolean navigationOk) {
        this.elementLoadTime = elementLoadTime != null ? elementLoadTime : "N/A";
        this.timing = timing;
        this.navigationOk = navigationOk;
    }

    static NavMeasurement failed() {
        return new NavMeasurement("N/A", new JSONObject(), false);
    }
}
