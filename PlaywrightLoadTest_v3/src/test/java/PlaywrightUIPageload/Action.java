package PlaywrightUIPageload;

import com.microsoft.playwright.Frame;
import com.microsoft.playwright.Page;
import com.microsoft.playwright.TimeoutError;

public class Action {

    public static void navigate(Page page, String url) {
        page.navigate(url);
    }

    public static void click(Page page, String selector) {
        page.click(selector);
    }

    public static void click(Frame frame, String selector) {
        frame.click(selector);
    }

    public static void setText(Page page, String selector, String text) {
        page.fill(selector, text);
    }

    public static void setText(Frame frame, String selector, String text) {
        frame.fill(selector, text);
    }

    public static void waitForSelector(Page page, String selector) {
        page.waitForSelector(selector).isVisible();
    }
    
    public static void waitFor(Page page, String selector) {
        page.waitForLoadState();
    }
    
    public static void waitUntilElementIsVisible(Frame frame, String selector,int timeout) {
        try {
            frame.waitForSelector(selector, new Frame.WaitForSelectorOptions().setState(com.microsoft.playwright.options.WaitForSelectorState.VISIBLE).setTimeout(timeout));
        } catch (TimeoutError e) {
            System.err.println("Element not visible within the timeout period: " + selector);
        }
    }

	public static void waitUntilElementIsVisible(Page page, String selector,int timeout) {
	    try {
	        page.waitForSelector(selector, new Page.WaitForSelectorOptions().setState(com.microsoft.playwright.options.WaitForSelectorState.VISIBLE).setTimeout(timeout));
	    } catch (TimeoutError e) {
	        System.err.println("Element not visible within the timeout period: " + selector);
	    }
	}

    public static void waitForSelector(Frame frame, String selector) {
        frame.waitForSelector(selector);
    }

    public static void selectOption(Page page, String selector, String value) {
        page.selectOption(selector, value);
    }

    public static void selectOption(Frame frame, String selector, String value) {
        frame.selectOption(selector, value);
    }

    public static void check(Page page, String selector) {
        page.check(selector);
    }

    public static void check(Frame frame, String selector) {
        frame.check(selector);
    }

    public static void uncheck(Page page, String selector) {
        page.uncheck(selector);
    }

    public static void uncheck(Frame frame, String selector) {
        frame.uncheck(selector);
    }

    public static void hover(Page page, String selector) {
        page.hover(selector);
    }

    public static void hover(Frame frame, String selector) {
        frame.hover(selector);
    }

    public static void pressKey(Page page, String selector, String key) {
        page.press(selector, key);
    }

    public static void pressKey(Frame frame, String selector, String key) {
        frame.press(selector, key);
    }

    public static void waitForTimeout(Page page, int timeout) {
        page.waitForTimeout(timeout);
    }
}
