export const DAY = 86400000;
// Product defaults, not a claim of optimal spacing for every learner or subject.
export const REVIEW_INTERVALS = [1, 3, 7, 14, 30];
export function nextReview(card, rating, now = Date.now()) {
  const step = rating === 'again' ? 0 : rating === 'partial' ? Math.max(0, (card.step || 0) - 1) : Math.min(REVIEW_INTERVALS.length - 1, (card.step || 0) + 1);
  return { step, intervalDays: REVIEW_INTERVALS[step], dueAt: new Date(now + REVIEW_INTERVALS[step] * DAY).toISOString() };
}
export function publicReview(card) {
  const { referenceAnswer, ...visible } = structuredClone(card);
  const last = card.attempts.at(-1);
  return { ...visible, referenceAnswer: last && !last.rating ? referenceAnswer : undefined, awaitingRating: !!last && !last.rating };
}
export function learningSummary(session, now = Date.now()) {
  const activities = session.blocks.filter(block => ['code', 'quiz', 'reflection'].includes(block.type));
  const lastAttempts = activities.map(block => session.attempts.filter(a => a.blockId === block.id).at(-1)).filter(Boolean);
  return {
    activities: activities.length,
    attempted: lastAttempts.length,
    passedChecks: lastAttempts.filter(a => a.result.status === 'passed').length,
    reviewedByTutor: lastAttempts.filter(a => a.review).length,
    needsPractice: lastAttempts.filter(a => a.review ? !a.review.passed : a.result.status === 'needs_work').length,
    reviewsDue: (session.reviews || []).filter(card => Date.parse(card.dueAt) <= now || card.attempts.at(-1)?.rating === null).length,
  };
}
