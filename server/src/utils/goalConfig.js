
function parseGoalConfig(rawGoal) {
  if (!rawGoal) {
    return {};
  }
  if (typeof rawGoal === 'string') {
    try {
      const parsed = JSON.parse(rawGoal);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof rawGoal === 'object' && !Array.isArray(rawGoal) ? rawGoal : {};
}

module.exports = {
  parseGoalConfig,
};
