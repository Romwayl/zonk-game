/**
 * Zonk Scoring Module
 * 
 * This module handles the scoring logic for the Zonk dice game.
 * 
 * Zonk Scoring Rules (to be implemented):
 * - Single 1: 100 points
 * - Single 5: 50 points
 * - Three of a kind (except 1s): 100 × face value (e.g., three 4s = 400)
 * - Three 1s: 1000 points
 * - Four or more of a kind: multiply three-of-a-kind score by 2 for each additional die
 * - Straight (1-2-3-4-5-6): 1500 points
 * - Three pairs: 1500 points
 * - Zonk: No scoring dice = 0 points, lose turn
 * 
 * TODO: Implement full scoring logic
 * TODO: Add unit tests for all scoring combinations
 * TODO: Validate selectedDice parameter (must be array of integers 1-6)
 */

/**
 * Compute the score for selected dice
 * @param {number[]} selectedDice - Array of dice values (1-6)
 * @returns {number} The score for the selected dice
 */
function computeScore(selectedDice) {
    // TODO: Implement Zonk scoring rules
    // This is a stub that returns 0
    // Replace with actual scoring logic
    return 0;
}

module.exports = {
    computeScore
};
