// Shared deterministic rules: block explicit profanity, not ordinary descriptions of distress.
((root, factory) => {
    const rules = factory();
    if (typeof module === 'object' && module.exports) module.exports = rules;
    else root.DearMeModeration = rules;
})(typeof window === 'undefined' ? globalThis : window, () => {
    const terms = Object.freeze(['씨발', '씨팔', '개새끼', '병신', '좆', '씹새끼', '존나', 'ㅅㅂ', 'ㅂㅅ']);
    const rules = terms.map(term => ({ term, pattern: new RegExp([...term.normalize('NFKC')].join('[\\s\\p{P}\\p{S}_]*'), 'iu') }));
    // Priority: present emergency > explicit self/other harm > illegal request > professional > uncertain > general.
    // A topic word alone (e.g. hacking, violence, medication) is not evidence of an emergency.
    function classifyInput(value) {
        const text = typeof value === 'string' ? value.normalize('NFKC').toLowerCase() : '';
        const compact = text.replace(/[\s\p{P}\p{S}_]/gu, '');
        const contextOnly = /(예방|교육|연구|소설|가상|가정|영화|예시|뉴스|과제|역사)/u.test(compact)
            && !/(나는|저는|내가|제가|내친구가|제친구가)(지금|이미|현재|당장)/u.test(compact);
        const resolved = /(지금은안전|이제는안전|지금은괜찮|이제괜찮|출혈이멈췄|상처가다나았)/u.test(compact);
        const explicitEmergency = /출혈.{0,8}(멈추지않|안멈|멎지않|계속)|피가.{0,6}(안멈|멈추지않|많이나)|숨을못쉬|숨이안쉬|의식이없|의식을잃|약을.{0,8}(한꺼번에많이먹었|과다복용했)|지금.{0,12}(칼에찔렸|칼로위협받|뛰어내리려|목을매려)/u.test(compact);
        if (explicitEmergency && !contextOnly && !resolved) return { type: 'emergency', confirmedRisk: true };
        const selfIntent = /죽고싶(?:어|다|고|네|은|어요)|죽어버리고싶|나를(?:해칠|해치고|죽일).{0,8}(방법|계획|생각)|내(?:몸|손목)을.{0,8}(긋고싶|베고싶|해치고싶)|자(?:살|해)(?:하고싶|할계획|할방법|하려고|하려해|할거)|스스로(?:해치고싶|죽으려)|목숨을끊(?:고싶|을생각|으려)|나자신을해치|wanttokillmyself|wanttodie/u.test(compact);
        const deniedIntent = /죽고싶지않|자살할생각(?:은|이)?없|자해할생각(?:은|이)?없/u.test(compact);
        if (selfIntent && !deniedIntent && !contextOnly && !resolved) return { type: 'self_harm', confirmedRisk: true };
        const otherIntent = /(?:그사람|다른사람|누군가|친구|상대|선생|교수|동료|걔|쟤|너|사람들)(?:을|를)?.{0,16}(다치게하고싶|해치고싶|죽이고싶|죽일거|해칠계획|찌르고싶|때리고싶)|(?:살인|살해)(?:하는방법|방법|할계획)|(?:사람|친구|상대)(?:을|를)?.{0,5}(죽이는방법|해치는방법)|wanttokillsomeone/u.test(compact);
        if (otherIntent && !contextOnly && !resolved) return { type: 'harm_others', confirmedRisk: true };
        const defensive = /(?:해킹|사기|마약|불법).{0,12}(?:피해|당했|예방|방지|막는|보호)|(?:내|제|본인)계정.{0,12}(복구|되찾|보안)|보안점검|허가받은|동의받은/u.test(compact);
        const illegalRequest = /(?:다른사람|남의|타인|상대).{0,16}(?:계정|비밀번호|개인정보).{0,16}(?:해킹|훔치|빼내|탈취|침입)|(?:해킹|사기|마약제조|마약구매|돈세탁|위조|몰래촬영|불법촬영|불법).{0,18}(?:방법|하는법|하는방법|들키지|회피|알려)|(?:들키지않|안들키|추적피하).{0,18}(?:해킹|침입|사기)|(?:hack|steal).{0,15}(?:someone|account|password)/u.test(compact);
        if (illegalRequest && !defensive) return { type: 'illegal', confirmedRisk: false, topic: /해킹|계정|비밀번호/u.test(compact) ? 'cyber' : 'other' };
        const safetyMention = /(?:^|[^가-힣])(?:자[\s\p{P}\p{S}_]*살|자[\s\p{P}\p{S}_]*해|살해|폭력)|해치(?:고|려|는|지|거나)|해칠(?:까|지|수|방법)|칼로.{0,2}위협|죽을.{0,2}방법|다치게/u.test(text);
        if (safetyMention && !contextOnly && !resolved && !deniedIntent) return { type: 'uncertain', confirmedRisk: false };
        if (/불면|잠을못|잠이안|약(?:을|먹|복용|처방)|진단|치료|증상|병원|의사|우울증|정신과|출혈|부상/u.test(compact)) return { type: 'medical', confirmedRisk: false };
        if (/계약금|소송|법률|변호사|계약서|보증금|고소|법원|손해배상|해킹피해|사기피해/u.test(compact)) return { type: 'legal', confirmedRisk: false };
        if (/대출|주식|투자|재정|금융|채무|부채|펀드|코인|수익률/u.test(compact)) return { type: 'financial', confirmedRisk: false };
        return { type: 'general', confirmedRisk: false };
    }
    function findProhibitedTerms(text) {
        if (typeof text !== 'string') return [];
        const normalized = text.normalize('NFKC');
        return rules.filter(rule => rule.pattern.test(normalized)).map(rule => rule.term);
    }
    function requiresSafetyResponse(text) { return ['emergency', 'self_harm', 'harm_others', 'uncertain'].includes(classifyInput(text).type); }
    return { terms, findProhibitedTerms, requiresSafetyResponse, classifyInput };
});
