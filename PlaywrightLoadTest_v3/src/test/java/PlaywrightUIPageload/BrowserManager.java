package PlaywrightUIPageload;

import com.microsoft.playwright.Browser;
import com.microsoft.playwright.BrowserType;
import com.microsoft.playwright.Playwright;

import java.util.Arrays;
import java.util.Map;

public class BrowserManager {

    public static Browser launchBrowser(Map<String, String> config, Playwright playwright) {
        return launchBrowser(config, playwright, 0);
    }

    public static Browser launchBrowser(Map<String, String> config, Playwright playwright, int workerId) {
        String browserType = config.getOrDefault("BrowserType", "chrome");
        boolean headlessMode = ConfigHelper.isHeadless(config);

        String workerLabel = workerId > 0 ? "[Worker " + workerId + "] " : "";
        System.out.println(workerLabel + "Launching dedicated browser: " + browserType
                + ", headless=" + headlessMode + ", thread=" + Thread.currentThread().getName());

        BrowserType.LaunchOptions options = new BrowserType.LaunchOptions()
                .setHeadless(headlessMode)
                .setArgs(Arrays.asList(
                        "--no-sandbox",
                        "--disable-dev-shm-usage",
                        "--disable-gpu"
                ));

        if ("chrome".equalsIgnoreCase(browserType) || "chromium".equalsIgnoreCase(browserType)) {
            return playwright.chromium().launch(options);
        }
        if ("firefox".equalsIgnoreCase(browserType)) {
            return playwright.firefox().launch(options);
        }
        if ("webkit".equalsIgnoreCase(browserType) || "safari".equalsIgnoreCase(browserType)) {
            return playwright.webkit().launch(options);
        }
        System.out.println("Unsupported browser type: " + browserType + " — falling back to chromium");
        return playwright.chromium().launch(options);
    }
}
