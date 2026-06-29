const cron = require('node-cron');
const { query } = require('../config/database');
const logger = require('../utils/logger');

const startCronJobs = () => {
  // Reset daily tokens every midnight
  cron.schedule('0 0 * * *', async () => {
    try {
      const result = await query(
        "UPDATE users SET daily_used_tokens = 0, last_token_reset = NOW() WHERE last_token_reset < NOW() - INTERVAL '24 hours'"
      );
      logger.info(`Daily token reset: ${result.rowCount} users`);
    } catch (error) {
      logger.error('Daily token reset failed:', error);
    }
  });

  // Reset monthly tokens on 1st of each month
  cron.schedule('0 0 1 * *', async () => {
    try {
      const result = await query(
        'UPDATE users SET monthly_used_tokens = 0, last_monthly_reset = NOW()'
      );
      logger.info(`Monthly token reset: ${result.rowCount} users`);
    } catch (error) {
      logger.error('Monthly token reset failed:', error);
    }
  });

  // Clean up expired refresh tokens every 6 hours
  cron.schedule('0 */6 * * *', async () => {
    try {
      const result = await query('DELETE FROM refresh_tokens WHERE expires_at < NOW()');
      logger.info(`Cleaned ${result.rowCount} expired refresh tokens`);
    } catch (error) {
      logger.error('Refresh token cleanup failed:', error);
    }
  });

  // Clean up old token logs older than 90 days
  cron.schedule('0 2 * * 0', async () => {
    try {
      const result = await query(
        "DELETE FROM token_logs WHERE created_at < NOW() - INTERVAL '90 days'"
      );
      logger.info(`Cleaned ${result.rowCount} old token logs`);
    } catch (error) {
      logger.error('Token log cleanup failed:', error);
    }
  });

  logger.info('Cron jobs started');
};

module.exports = { startCronJobs };
