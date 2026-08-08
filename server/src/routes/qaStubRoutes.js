const express = require('express');
const { requireShop } = require('../middleware/shopContext');

const router = express.Router();

/** Soft stub — Classic Activity tab expects this; Self-QA is optional in RipsPriceX. */
router.get('/tests/:id/runs', requireShop, (req, res) => {
  res.json({ success: true, runs: [] });
});

module.exports = router;
