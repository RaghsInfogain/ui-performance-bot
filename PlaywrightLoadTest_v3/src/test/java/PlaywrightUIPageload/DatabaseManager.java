package PlaywrightUIPageload;

import java.sql.*;
import java.util.Date;

public class DatabaseManager implements AutoCloseable {

    private Connection connection;

    public DatabaseManager(String jdbcUrl, String jdbcUser, String jdbcPassword) throws SQLException {
        this.connection = DriverManager.getConnection(jdbcUrl, jdbcUser, jdbcPassword);
    }

    public void insertTestResult(Date timestamp, String transactionName, String pageUrl, Integer fullPageLoadTime, String elementLoadTime, String testStatus) {
        try (PreparedStatement statement = connection.prepareStatement(
                "INSERT INTO test_results (timestamp, transaction_name, page_url, full_page_load_time, element_load_time, test_status) VALUES (?, ?, ?, ?, ?, ?)"
        )) {
            statement.setTimestamp(1, new Timestamp(timestamp.getTime()));
            statement.setString(2, transactionName);
            statement.setString(3, pageUrl);
            statement.setInt(4, fullPageLoadTime != null ? fullPageLoadTime : -1);
            statement.setString(5, elementLoadTime != null ? elementLoadTime : "N/A");
            statement.setString(6, testStatus);
            statement.executeUpdate();
        } catch (SQLException e) {
            e.printStackTrace();
        }
    }

    @Override
    public void close() throws Exception {
        if (connection != null && !connection.isClosed()) {
            connection.close();
        }
    }

	public void insertTestResult(Date date, String string, String pageUrl, Integer fullPageLoadTime,
			String elementLoadTime, Object testStatus) {
		// TODO Auto-generated method stub
		
	}
}
