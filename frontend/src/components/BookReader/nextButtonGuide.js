export const shouldShowNextGuide = ({
    showChatPanel,
    currentQuestionComplete,
    canPerformAction,
}) => showChatPanel && currentQuestionComplete && canPerformAction;
