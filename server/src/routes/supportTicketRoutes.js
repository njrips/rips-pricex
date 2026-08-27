const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/asyncHandler');
const { sendError, sendSuccess } = require('../utils/response');
const { HTTP_STATUS } = require('../constants');
const { normalizeShopDomain } = require('../models/supportTicket');
const {
  isPublicIdFormat,
  createMerchantTicket,
  addMerchantMessage,
  getMerchantTicket,
  listMerchantTickets,
} = require('../services/support/supportTicketService');

function shopFrom(req) {
  return normalizeShopDomain(req.shopDomain);
}

function handleServiceError(res, err) {
  const status = Number(err.status || err.statusCode || HTTP_STATUS.INTERNAL_SERVER_ERROR);
  return sendError(res, status, err.message || 'Support request failed');
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const tickets = await listMerchantTickets(shopFrom(req));
    return sendSuccess(res, HTTP_STATUS.OK, { tickets });
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    try {
      const result = await createMerchantTicket(shopFrom(req), req.body || {});
      return sendSuccess(res, HTTP_STATUS.CREATED, result);
    } catch (err) {
      return handleServiceError(res, err);
    }
  })
);

router.get(
  '/:publicId',
  asyncHandler(async (req, res) => {
    if (!isPublicIdFormat(req.params.publicId)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid ticket id');
    }
    const ticket = await getMerchantTicket(shopFrom(req), req.params.publicId);
    if (!ticket) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'Ticket not found');
    }
    return sendSuccess(res, HTTP_STATUS.OK, { ticket });
  })
);

router.post(
  '/:publicId/messages',
  asyncHandler(async (req, res) => {
    if (!isPublicIdFormat(req.params.publicId)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid ticket id');
    }
    try {
      const result = await addMerchantMessage(
        shopFrom(req),
        req.params.publicId,
        req.body?.body || req.body?.message
      );
      return sendSuccess(res, HTTP_STATUS.CREATED, result);
    } catch (err) {
      return handleServiceError(res, err);
    }
  })
);

module.exports = router;
