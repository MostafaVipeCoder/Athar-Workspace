/**
 * Unread badge text: a number up to 99, then "99+"; empty for none.
 * A module of its own with NO imports: the founder SHELL (part of the `routes` chunk every visitor downloads) needs only this, not the notification / opportunity helpers of lib/alumniFounder.js.
 */
export const badgeCount = (n) => (!Number.isFinite(Number(n)) || Number(n) <= 0 ? '' : Number(n) > 99 ? '99+' : String(Math.floor(Number(n))))
