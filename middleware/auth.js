function requireLogin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Please log in to continue." });
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user) return res.status(401).json({ error: "Please log in to continue." });
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).json({ error: "You do not have permission to perform this action." });
    }
    next();
  };
}

module.exports = { requireLogin, requireRole };
