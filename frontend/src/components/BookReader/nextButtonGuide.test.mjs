import assert from 'node:assert/strict';
import { shouldShowNextGuide } from './nextButtonGuide.js';

assert.equal(
    shouldShowNextGuide({
        showChatPanel: true,
        currentQuestionComplete: true,
        canPerformAction: true,
    }),
    true,
    'shows guide after a completed first question when Next advances to another question',
);

assert.equal(
    shouldShowNextGuide({
        showChatPanel: true,
        currentQuestionComplete: true,
        canPerformAction: false,
    }),
    false,
    'does not show guide while Next is blocked',
);

assert.equal(
    shouldShowNextGuide({
        showChatPanel: false,
        currentQuestionComplete: true,
        canPerformAction: true,
    }),
    false,
    'does not show guide outside the chat panel flow',
);
