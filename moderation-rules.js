// Shared deterministic rules: block explicit profanity, not ordinary descriptions of distress.
((root, factory) => {
    const rules = factory();
    if (typeof module === 'object' && module.exports) module.exports = rules;
    else root.DearMeModeration = rules;
})(typeof window === 'undefined' ? globalThis : window, () => {
    const terms = Object.freeze(['씨발', '씨팔', '개새끼', '병신', '좆', '씹새끼', '존나', 'ㅅㅂ', 'ㅂㅅ']);
    const rules = terms.map(term => ({ term, pattern: new RegExp([...term.normalize('NFKC')].join('[\\s\\p{P}\\p{S}_]*'), 'iu') }));
    const dangerPattern = /자[\s\p{P}\p{S}_]*살|자[\s\p{P}\p{S}_]*해|살[\s\p{P}\p{S}_]*해|폭[\s\p{P}\p{S}_]*력|마[\s\p{P}\p{S}_]*약|죽고\s*싶|죽어\s*버|죽이|죽일|목숨|극단적\s*선택|손목.{0,12}(긋|베)|뛰어내|해치|해칠|칼로.{0,12}(찌르|찔)|suicid|self[ -]?harm|kill\s+(myself|someone|him|her)|murder|cocaine|methamphetamine/iu;
    function findProhibitedTerms(text) {
        if (typeof text !== 'string') return [];
        const normalized = text.normalize('NFKC');
        return rules.filter(rule => rule.pattern.test(normalized)).map(rule => rule.term);
    }
    function requiresSafetyResponse(text) { return typeof text === 'string' && dangerPattern.test(text.normalize('NFKC')); }
    return { terms, findProhibitedTerms, requiresSafetyResponse };
});
