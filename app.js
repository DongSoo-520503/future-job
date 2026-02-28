const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(__dirname));

const jobData = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'future_job_final_3960.json'), 'utf8'));

// ══════════════════════════════════════════════════════════════
// 방법 1 적용: RIASEC ↔ Big5 간 불필요한 중복 키워드 선별 제거
//
// 제거한 중복 4개:
//   '글로벌'   → RIASEC E에서 제거 (Big5 E에만 유지)
//   '프로세스' → Big5 C에서 제거  (RIASEC C에만 유지)
//   '체계'     → Big5 C에서 제거  (RIASEC C에만 유지)
//   '수립'     → Big5 C에서 제거  (RIASEC C에만 유지)
//
// 불가피하게 유지되는 중복 9개는 방법 2(정규화)로 영향 희석:
//   '창의'(A↔O), '의료·복지·보건·돌봄·공감·사회적'(S↔A), '교육·커뮤니티'(S↔E)
// ══════════════════════════════════════════════════════════════

const riasecKeywords = {
    // R: 도구·장치·공학 구현 키워드
    'R': ['설계', '하드웨어', '인프라', '로봇', '센서', '제어', '회로', '엔지니어링', '제조', '자동화'],

    // I: 탐구·연구·알고리즘 키워드
    'I': ['양자', '알고리즘', '연구', '탐구', '시뮬레이션', '모델링', '실험', '데이터 과학', '최적화', '분석'],

    // A: 창작·표현·UX 키워드
    'A': ['창의', '콘텐츠', '디자인', '기획', '스토리', '인터페이스', '명령어', '프롬프트', '메타버스', '가상현실'],

    // S: 사람 중심 직업 키워드
    'S': ['의료', '복지', '보건', '상담', '교육', '돌봄', '치료', '공감', '커뮤니티', '사회적'],

    // E: 비즈니스·리더십·전략 키워드 ('글로벌' 제거 → Big5 E에만 유지)
    'E': ['비즈니스', '전략', '경영', '리더', '정책', '스타트업', '투자', '협상', '민간', '혁신 경영'],

    // C: 체계·규정·품질관리 키워드
    'C': ['품질 관리', '프로세스', '규정', '감사', '체계', '수립', '운영 효율', '표준화', '인증', '컴플라이언스']
};

const big5Keywords = {
    // O(개방성): 혁신·융합·미래지향 키워드
    'O': ['혁신', '차세대', '새로운', '창의', '미래', '융합', '도전', '선도', '개척', '트렌드'],

    // C(성실성): 계획·정밀·품질 키워드 ('프로세스','체계','수립' 제거 → RIASEC C에만 유지)
    'C': ['기준', '효율', '목표', '정밀', '계획', '품질', '일정', '마감', '책임', '완수'],

    // E(외향성): 소통·협업·네트워크 키워드
    'E': ['소통', '협업', '커뮤니티', '서비스', '교육', '네트워크', '글로벌', '팀', '발표', '강연'],

    // A(우호성): 돌봄·신뢰·지원 키워드
    'A': ['의료', '복지', '보건', '공감', '신뢰', '지원', '돌봄', '사회적', '배려', '봉사'],

    // N(신경증): 위험·보안·안전 모니터링 키워드
    'N': ['안전', '보호', '리스크', '감시', '모니터링', '예방', '보안', '안정화', '위기', '대응']
};

// ══════════════════════════════════════════════════════════════
// 키워드 등장 횟수 기반 원점수 계산 함수
// 단순 포함 여부(0/1) 대신 등장 횟수 반영, 최대 3회까지 인정
// ══════════════════════════════════════════════════════════════
function calcScore(desc, keywords) {
    if (!keywords || keywords.length === 0) return 0;
    const maxPerKeyword = 3;
    const rawScore = keywords.reduce((sum, kw) => {
        const count = desc.split(kw).length - 1;
        return sum + Math.min(count, maxPerKeyword);
    }, 0);
    const maxPossible = keywords.length * maxPerKeyword;
    return (rawScore / maxPossible) * 100;
}

app.post('/recommend', (req, res) => {
    const { name, dob, country, ability, riasec, big5 } = req.body;

    // 날짜 파싱: substring으로 연도만 안전하게 추출
    const birthYear = parseInt((dob || '').substring(0, 4));
    if (isNaN(birthYear) || birthYear < 1900 || birthYear > 2100) {
        return res.status(400).json({
            error: '생년월일 형식이 올바르지 않습니다. 예) 2010-03-15 형식으로 입력해 주세요.'
        });
    }

    const year = birthYear + 25;
    const period = `${Math.floor(year / 10) * 10}년대`;

    const candidates = jobData.filter(row =>
        row['국가'] === country && row['시기'] === period && row['직업등급'] === ability
    );
    const candidateCount = candidates.length;

    if (candidateCount === 0) {
        return res.status(404).json({
            error: `'${period}' 데이터가 없습니다. 지원 생년월일: 2005년~2034년생 (취업시기 2030~2050년대)`
        });
    }

    const rkws = riasecKeywords[riasec] || [];
    const bkws = big5Keywords[big5] || [];

    // 1단계: 각 후보의 원점수 계산
    candidates.forEach(row => {
        const desc = row['직업해설'] || '';
        row.riasec_raw = calcScore(desc, rkws);
        row.big5_raw   = calcScore(desc, bkws);
    });

    // ══════════════════════════════════════════════════════════
    // 방법 2 적용: 후보군 내 상대 정규화 (0~100 스케일)
    //
    // RIASEC 최고점 → 100점, Big5 최고점 → 100점으로 각각 독립 정규화.
    // 두 차원이 서로 독립적으로 최종 점수에 기여하게 되어
    // 중복 키워드로 인한 편향이 자동 희석됨.
    // ══════════════════════════════════════════════════════════
    const maxR = Math.max(...candidates.map(r => r.riasec_raw), 1);
    const maxB = Math.max(...candidates.map(r => r.big5_raw),   1);

    candidates.forEach(row => {
        row.riasec_score = Math.round((row.riasec_raw / maxR) * 100 * 100) / 100;
        row.big5_score   = Math.round((row.big5_raw   / maxB) * 100 * 100) / 100;
        row.final_score  = Math.round((row.riasec_score * 0.6 + row.big5_score * 0.4) * 100) / 100;
    });

    // 전체 원점수가 모두 0인 경우 → 연봉순위 기준으로만 추천됨을 안내
    const allZero = candidates.every(row => row.riasec_raw === 0 && row.big5_raw === 0);

    candidates.sort((a, b) =>
        b.final_score - a.final_score || parseInt(a['연봉순위']) - parseInt(b['연봉순위'])
    );
    const best = candidates[0];

    const zeroScoreNote = allZero
        ? '\n※ 성향 키워드 매칭 결과가 없어 연봉순위 기준으로 최상위 직업을 추천하였습니다.'
        : '';

    const text = `1. 출력 결과

성명: ${name}
국가: ${country} / 취업시기: ${period}
추천직업: ${best['추천직업']}
연봉순위: ${period} ${country} 10대 유망 미래 직종 중 ${best['연봉순위']}위에 해당될 만큼 높은 가치를 지닙니다.
직업해설: ${best['직업해설']}
핵심 전문지식: ${best['핵심 전문지식']}
추천 학과/전공: ${best['추천 학과/전공']}
준비 기간: ${best['준비 기간']}

2. 매칭 분석

조건 필터링: 국가, 시기, 등급 데이터를 기반으로 1차 후보군 ${candidateCount}개를 추출하였습니다.
성향 점수화: 직업흥미유형(RIASEC) 적합도 ${best.riasec_score.toFixed(1)}점, 개인성향(Big5) 적합도 ${best.big5_score.toFixed(1)}점을 60:40 가중평균하여 최종 적합도 ${best.final_score}점을 산출하였습니다.
최종 선택: 적합도 점수와 연봉순위를 종합하여 최적의 직업 1종을 선정하였습니다.${zeroScoreNote}`;

    const buttons = `<div style="margin-top:12px;padding:16px;background:#f8f9fa;border-radius:10px;border:1px solid #dee2e6;"><p style="margin:0 0 12px 0;font-size:14px;font-weight:bold;color:#333;line-height:1.6;">💡 미래 직업 선택과 관련하여 궁금한 점이 있으시면, 아래의 L.L.M. 모델 중 본인이 가입한 모델을 눌러 문의해 보세요.</p><div style="display:flex;flex-direction:column;gap:8px;"><a href="https://chat.openai.com" target="_blank" style="text-decoration:none;"><button style="width:100%;padding:12px 16px;font-size:14px;font-weight:bold;background:#10a37f;color:white;border:none;border-radius:8px;cursor:pointer;text-align:left;">💬 ChatGPT &nbsp;|&nbsp; <span style="font-weight:normal;font-size:13px;">창작 · 글쓰기 · 대화에 강함</span></button></a><a href="https://gemini.google.com" target="_blank" style="text-decoration:none;"><button style="width:100%;padding:12px 16px;font-size:14px;font-weight:bold;background:#4285f4;color:white;border:none;border-radius:8px;cursor:pointer;text-align:left;">✨ Gemini &nbsp;|&nbsp; <span style="font-weight:normal;font-size:13px;">구글 연동 · 코딩에 강함</span></button></a><a href="https://claude.ai" target="_blank" style="text-decoration:none;"><button style="width:100%;padding:12px 16px;font-size:14px;font-weight:bold;background:#d97706;color:white;border:none;border-radius:8px;cursor:pointer;text-align:left;">🤖 Claude &nbsp;|&nbsp; <span style="font-weight:normal;font-size:13px;">심층 분석 · 문서 작성에 강함</span></button></a><a href="https://www.perplexity.ai" target="_blank" style="text-decoration:none;"><button style="width:100%;padding:12px 16px;font-size:14px;font-weight:bold;background:#6366f1;color:white;border:none;border-radius:8px;cursor:pointer;text-align:left;">🔎 Perplexity &nbsp;|&nbsp; <span style="font-weight:normal;font-size:13px;">정보검색 · 최신 웹 요약에 강함</span></button></a><a href="https://grok.com" target="_blank" style="text-decoration:none;"><button style="width:100%;padding:12px 16px;font-size:14px;font-weight:bold;background:#1d9bf0;color:white;border:none;border-radius:8px;cursor:pointer;text-align:left;">⚡ Grok &nbsp;|&nbsp; <span style="font-weight:normal;font-size:13px;">심층 질문 · 뉴스 분석에 강함</span></button></a><a href="https://chat.deepseek.com" target="_blank" style="text-decoration:none;"><button style="width:100%;padding:12px 16px;font-size:14px;font-weight:bold;background:#e53e3e;color:white;border:none;border-radius:8px;cursor:pointer;text-align:left;">🐋 DeepSeek &nbsp;|&nbsp; <span style="font-weight:normal;font-size:13px;">무료 · 코딩 · 논리 추론에 강함</span></button></a></div></div>`;

    res.json({ text, buttons });
// 브라우저에서 바로 열어볼 수 있는 홈페이지 추가 (GET /)
app.get('/', (req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(`
    <!DOCTYPE html>
    <html lang="ko">
    <head>
      <meta charset="UTF-8">
      <title>미래 직업 추천 앱</title>
      <style>
        body { font-family: sans-serif; padding: 20px; max-width: 600px; margin: auto; background: #f9f9f9; }
        h1 { color: #2c3e50; text-align: center; }
        form { background: white; padding: 20px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        label { display: block; margin: 15px 0 5px; font-weight: bold; }
        input, textarea { width: 100%; padding: 10px; margin-bottom: 15px; border: 1px solid #ddd; border-radius: 5px; box-sizing: border-box; }
        button { width: 100%; padding: 12px; background: #27ae60; color: white; border: none; border-radius: 5px; font-size: 16px; cursor: pointer; }
        button:hover { background: #219653; }
        p.note { margin-top: 30px; font-size: 0.9em; color: #777; text-align: center; }
      </style>
    </head>
    <body>
      <h1>미래 직업 추천 테스트</h1>
      <p>이름, 출생년도, 자기소개를 입력하고 추천 받아보세요!</p>
      
      <form action="/recommend" method="POST">
        <label for="name">이름</label>
        <input type="text" id="name" name="name" placeholder="예: 동수" required>
        
        <label for="birthYear">출생년도</label>
        <input type="number" id="birthYear" name="birthYear" placeholder="예: 1995" required>
        
        <label for="description">자기소개 / 꿈 / 관심 분야</label>
        <textarea id="description" name="description" rows="6" placeholder="예: AI와 개발에 관심 많아요. 창의적인 일을 하고 싶습니다."></textarea>
        
        <button type="submit">미래 직업 추천 받기</button>
      </form>
      
      <p class="note">※ 추천 결과는 JSON 형식으로 표시됩니다. (브라우저에서 보기 불편하면 Postman 사용 추천)</p>
    </body>
    </html>
  `);
    
});

const PORT = process.env.PORT || 3000;  // Render가 PORT 환경변수 자동으로 줌 (보통 10000번대)
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
