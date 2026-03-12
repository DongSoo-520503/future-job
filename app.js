const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(__dirname));

const jobData = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'data', 'future_job_3960.json'), 'utf8')
);

// ─────────────────────────────────────────────────────────────
//  RIASEC·BIG5 컬럼 구성 원칙 (데이터 준비 단계에서 이미 반영)
//
//  각 직업 행의 RIASEC·BIG5는 직업분류·직업해설·핵심 전문 지식·
//  추천 학과/전공 등을 종합 분석하여 채워진 1~2개 코드 문자열
//    예) RIASEC: "R,C" / "S,E" / "I,E" / "A" 등
//        BIG5:   "O,E" / "C"   / "N,C" / "A,E" 등
//
//  매칭 점수 산출 원칙
//    - 사용자 선택 코드가 직업 코드에 포함되면 → 100점 (1.0)
//    - 포함되지 않으면                         →  50점 (0.5)
//
//  최종 점수 = RIASEC 매칭점수 × 0.6 + BIG5 매칭점수 × 0.4
//    RIASEC 100점 + BIG5 100점 → 100점
//    RIASEC 100점 + BIG5  50점 →  80점
//    RIASEC  50점 + BIG5 100점 →  70점
//    RIASEC  50점 + BIG5  50점 →  50점
// ─────────────────────────────────────────────────────────────

/**
 * 사용자 선택 코드가 직업 코드 배열에 하나라도 포함되면 100점, 아니면 50점
 * @param {string[]} rowCodes  - 직업 행의 코드 배열 (1~2개)
 * @param {string[]} userCodes - 사용자가 선택한 코드 배열 (1~2개)
 * @returns {number} 1.0(100점) | 0.5(50점)
 */
function matchScore(rowCodes, userCodes) {
  const matched = userCodes.some(code => rowCodes.includes(code));
  return matched ? 1.0 : 0.5;
}

app.post('/recommend', (req, res) => {
  const { name, dob, country, ability, riasec, big5 } = req.body;

  // ── 입력값 검증 ─────────────────────────────────────────
  const birthYear = parseInt(dob, 10);
  if (Number.isNaN(birthYear) || birthYear < 1900 || birthYear > 2100) {
    return res.status(400).json({
      error: '출생연도 형식이 올바르지 않습니다. 예) 2010 형식으로 입력해 주세요.'
    });
  }

  // riasec·big5: 단일 문자열("R") 또는 배열(["R","I"]) 모두 허용
  const riasecList = Array.isArray(riasec)
    ? riasec.map(s => s.trim()).filter(Boolean)
    : [String(riasec || '').trim()].filter(Boolean);

  const big5List = Array.isArray(big5)
    ? big5.map(s => s.trim()).filter(Boolean)
    : [String(big5 || '').trim()].filter(Boolean);

  if (riasecList.length === 0 || big5List.length === 0) {
    return res.status(400).json({
      error: 'RIASEC과 BIG5 유형을 각각 1~2개 선택해 주세요.'
    });
  }

  // ── 취업 시기 산출 ──────────────────────────────────────
  const addYear = ability === '상' ? 30 : ability === '중' ? 26 : 22;
  const year    = birthYear + addYear;
  const period  = `${Math.floor(year / 10) * 10}년대`;

  // ── 1단계: 국가·시기·등급 필터 ─────────────────────────
  // jobData 원본 오염 방지를 위해 복사본으로 작업
  const candidates = jobData
    .filter(
      row => row['국가']     === country &&
             row['시기']     === period  &&
             row['직업등급'] === ability
    )
    .map(row => ({ ...row }));  // ← 원본 참조 차단, 복사본 사용

  if (candidates.length === 0) {
    return res.status(404).json({
      error: `'${period}' 취업시기의 데이터는 없습니다. ` +
             `[출생년도]와 [학업계획] 선택은 밀접한 관계가 있습니다. 잘못 입력시, 가능한 취업시기 2030년~2059년 범위를 벗어납니다.`
    });
  }

  // ── 2단계: RIASEC·BIG5 매칭 점수 산출 ──────────────────
  //
  //  사용자 선택 코드가 직업 코드에 포함 여부로 점수 산출
  //  포함 → 100점(1.0) / 미포함 → 50점(0.5)
  //  최종 = RIASEC × 0.6 + BIG5 × 0.4
  // ─────────────────────────────────────────────────────────
  candidates.forEach(row => {
    const rowRiasec = (row['RIASEC'] || '').split(',').map(s => s.trim()).filter(Boolean);
    const rowBig5   = (row['BIG5']   || '').split(',').map(s => s.trim()).filter(Boolean);

    row.riasec_score = matchScore(rowRiasec, riasecList);
    row.big5_score   = matchScore(rowBig5,   big5List);

    // 6:4 가중 평균 → 최종 점수 (50 / 70 / 80 / 100점 중 하나)
    row.final_score = Math.round(
      (row.riasec_score * 0.6 + row.big5_score * 0.4) * 100
    ) / 100;
  });

  // ── 3단계: 정렬 (final_score↓ → 연봉순위↑) ─────────────
  candidates.sort(
    (a, b) => b.final_score - a.final_score ||
              parseInt(a['연봉순위'], 10) - parseInt(b['연봉순위'], 10)
  );

  const best     = candidates[0];
  const topCount = candidates.filter(r => r.final_score === best.final_score).length;

  // ── 4단계: 응답 ─────────────────────────────────────────
  res.json({
    name,
    country,
    period,
    job:            best['추천직업']       || '',
    salaryRank:     best['연봉순위']        || '',
    description:    best['직업해설']       || '',
    knowledge:      best['핵심 전문 지식'] || '',
    major:          best['추천 학과/전공'] || '',
    prepPeriod:     best['준비 기간']      || '',
    candidateCount: candidates.length,
    topCount,
    riasecScore:    (best.riasec_score * 100).toFixed(0) + '%',
    big5Score:      (best.big5_score   * 100).toFixed(0) + '%',
    finalScore:     (best.final_score  * 100).toFixed(0) + '%'
  });
});

// 새 코드 (추가)
if (require.main === module) {
  const PORT = Number(process.env.PORT) || 3002;
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = app;

