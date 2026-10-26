const { sendError } = require('../utils/response');
const { HTTP_STATUS } = require('../constants');
const {
  CONSOLE_MEMBER_HEADER,
  CONSOLE_PROOF_HEADER,
  isValidConsoleProof,
} = require('../services/console/consoleInternalAuth');
const { findActiveMemberByEmail, roleAllows } = require('../services/console/teamMembers');

function requireConsoleMember(role = 'support', deps = {}) {
  const findMember = deps.findActiveMemberByEmail || findActiveMemberByEmail;
  return async function consoleMemberMiddleware(req, res, next) {
    try {
      const email = String(req.get(CONSOLE_MEMBER_HEADER) || '');
      const proof = String(req.get(CONSOLE_PROOF_HEADER) || '');
      if (!email || !isValidConsoleProof(email, proof)) {
        return sendError(res, HTTP_STATUS.UNAUTHORIZED, 'Console sign-in required');
      }
      const member = await findMember(email);
      if (!member) {
        return sendError(res, HTTP_STATUS.UNAUTHORIZED, 'Console sign-in required');
      }
      if (!roleAllows(member.role, role)) {
        return sendError(res, HTTP_STATUS.FORBIDDEN, 'Only owners can do this');
      }
      req.consoleMember = member;
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = { requireConsoleMember };
