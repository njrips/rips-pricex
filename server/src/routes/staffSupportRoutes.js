const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/asyncHandler');
const { sendError, sendSuccess } = require('../utils/response');
const { HTTP_STATUS } = require('../constants');
const {
  isPublicIdFormat,
  listStaffTickets,
  getStaffTicket,
  addStaffMessage,
  setStaffTicketStatus,
} = require('../services/support/supportTicketService');

function handleServiceError(res, err) {
  const status = Number(err.status || err.statusCode || HTTP_STATUS.INTERNAL_SERVER_ERROR);
  return sendError(res, status, err.message || 'Support request failed');
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const tickets = await listStaffTickets({
      status: req.query.status,
      shop: req.query.shop || req.query.shop_domain,
      q: req.query.q,
      limit: req.query.limit,
    });
    return sendSuccess(res, HTTP_STATUS.OK, { tickets });
  })
);

router.get(
  '/:publicId',
  asyncHandler(async (req, res) => {
    if (!isPublicIdFormat(req.params.publicId)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid ticket id');
    }
    const ticket = await getStaffTicket(req.params.publicId);
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
      const result = await addStaffMessage(req.params.publicId, req.body?.body || req.body?.message);
      return sendSuccess(res, HTTP_STATUS.CREATED, result);
    } catch (err) {
      return handleServiceError(res, err);
    }
  })
);

router.patch(
  '/:publicId',
  asyncHandler(async (req, res) => {
    if (!isPublicIdFormat(req.params.publicId)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid ticket id');
    }
    try {
      const ticket = await setStaffTicketStatus(req.params.publicId, req.body?.status);
      return sendSuccess(res, HTTP_STATUS.OK, { ticket });
    } catch (err) {
      return handleServiceError(res, err);
    }
  })
);

module.exports = router;
