package PlaywrightUIPageload;

import com.microsoft.playwright.Frame;
import com.microsoft.playwright.Page;
import com.microsoft.playwright.TimeoutError;

public class Action {

    public static String playwrightSelector(String selector) {
        if (selector == null) return null;
        String sel = selector.trim();
        if (sel.isEmpty() || "NA".equalsIgnoreCase(sel) || "N/A".equalsIgnoreCase(sel)) return sel;
        if (sel.startsWith("xpath=") || sel.startsWith("css=") || sel.startsWith("text=") || sel.startsWith("id=")) {
            return sel;
        }
        if (sel.startsWith("//") || sel.startsWith("(//")) {
            return "xpath=" + sel;
        }
        return sel;
    }

    public static void navigate(Page page, String url) {
        page.navigate(url, new Page.NavigateOptions()
                .setWaitUntil(com.microsoft.playwright.options.WaitUntilState.DOMCONTENTLOADED)
                .setTimeout(90000));
    }

    public static void click(Page page, String selector) {
        page.click(playwrightSelector(selector));
    }

    public static void click(Frame frame, String selector) {
        frame.click(playwrightSelector(selector));
    }

    public static void setText(Page page, String selector, String text) {
        page.fill(playwrightSelector(selector), text);
    }

    public static void setText(Frame frame, String selector, String text) {
        frame.fill(playwrightSelector(selector), text);
    }

    public static void waitForSelector(Page page, String selector) {
        page.waitForSelector(playwrightSelector(selector)).isVisible();
    }
    
    public static void waitFor(Page page, String selector) {
        page.waitForLoadState();
    }
    
    public static void waitUntilElementIsVisible(Frame frame, String selector,int timeout) {
        try {
            frame.waitForSelector(playwrightSelector(selector), new Frame.WaitForSelectorOptions().setState(com.microsoft.playwright.options.WaitForSelectorState.VISIBLE).setTimeout(timeout));
        } catch (TimeoutError e) {
            System.err.println("Element not visible within the timeout period: " + selector);
        }
    }

	public static void waitUntilElementIsVisible(Page page, String selector,int timeout) {
	    try {
	        page.waitForSelector(playwrightSelector(selector), new Page.WaitForSelectorOptions().setState(com.microsoft.playwright.options.WaitForSelectorState.VISIBLE).setTimeout(timeout));
	    } catch (TimeoutError e) {
	        System.err.println("Element not visible within the timeout period: " + selector);
	    }
	}

    public static void waitForSelector(Frame frame, String selector) {
        frame.waitForSelector(playwrightSelector(selector));
    }

    public static void selectOption(Page page, String selector, String value) {
        page.selectOption(playwrightSelector(selector), value);
    }

    public static void selectOption(Frame frame, String selector, String value) {
        frame.selectOption(playwrightSelector(selector), value);
    }

    public static void check(Page page, String selector) {
        page.check(playwrightSelector(selector));
    }

    public static void check(Frame frame, String selector) {
        frame.check(playwrightSelector(selector));
    }

    public static void uncheck(Page page, String selector) {
        page.uncheck(playwrightSelector(selector));
    }

    public static void uncheck(Frame frame, String selector) {
        frame.uncheck(playwrightSelector(selector));
    }

    public static void hover(Page page, String selector) {
        page.hover(playwrightSelector(selector));
    }

    public static void hover(Frame frame, String selector) {
        frame.hover(playwrightSelector(selector));
    }

    public static void pressKey(Page page, String selector, String key) {
        page.press(playwrightSelector(selector), key);
    }

    public static void pressKey(Frame frame, String selector, String key) {
        frame.press(playwrightSelector(selector), key);
    }

    public static void waitForTimeout(Page page, int timeout) {
        page.waitForTimeout(timeout);
    }
}
