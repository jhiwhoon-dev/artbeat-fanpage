import pandas as pd
import json
import re
import math
from pathlib import Path

# 이 스크립트 파일(scripts/xlsx_to_json.py) 기준으로 프로젝트 루트를 자동 계산.
# 그래서 어떤 PC/환경에서 돌리든 경로를 수동으로 안 고쳐도 됩니다.
PROJECT_ROOT = Path(__file__).resolve().parent.parent  # scripts/ 의 부모 = 프로젝트 루트
SRC = PROJECT_ROOT.parent / "artbeat_claude.xlsx"       # 프로젝트 루트 바로 위(d:/ARTBEAT/)에 엑셀이 있다고 가정
OUT = PROJECT_ROOT / "src" / "data" / "members.json"

# ---------- 한글 -> 로마자 (id 자동 생성용) ----------
CHO = ['g','kk','n','d','tt','r','m','b','pp','s','ss','','j','jj','ch','k','t','p','h']
JUNG = ['a','ae','ya','yae','eo','e','yeo','ye','o','wa','wae','oe','yo','u','wo','we','wi','yu','eu','ui','i']
JONG = ['','g','kk','gs','n','nj','nh','d','l','lg','lm','lb','ls','lt','lp','lh','m','b','bs','s','ss','ng','j','ch','k','t','p','h']

# 관용적으로 쓰이는 성씨 표기 (표준 로마자 표기법과 다른 것만 override)
SURNAME_OVERRIDES = {
    '김': 'kim', '박': 'park', '이': 'lee', '최': 'choi', '정': 'jung',
    '조': 'cho', '장': 'jang', '임': 'lim', '한': 'han', '오': 'oh',
    '서': 'seo', '신': 'shin', '권': 'kwon', '황': 'hwang', '안': 'ahn',
    '송': 'song', '유': 'yoo', '홍': 'hong', '고': 'ko', '문': 'moon',
    '양': 'yang', '손': 'son', '배': 'bae', '백': 'baek', '허': 'heo',
    '남': 'nam', '심': 'shim', '노': 'noh', '하': 'ha', '곽': 'kwak',
    '차': 'cha', '주': 'joo', '우': 'woo', '구': 'koo', '나': 'na',
    '민': 'min', '류': 'ryu', '진': 'jin', '천': 'chun', '강': 'kang',
}

def romanize_char(ch):
    code = ord(ch) - 0xAC00
    if code < 0 or code > 11171:
        return ch
    cho, jung, jong = code // 588, (code % 588) // 28, code % 28
    return CHO[cho] + JUNG[jung] + JONG[jong]

def generate_id(name):
    name = str(name).strip()
    if not name:
        return None
    if " " in name:
        # 공백이 있는 이름(외국인 멤버 음차 표기 등)은 성/이름 구분 규칙이 다르므로
        # 각 단어를 통째로 로마자 변환 후 하이픈으로 연결 (id 검수를 강력히 권장)
        parts = [''.join(romanize_char(c) for c in word) for word in name.split()]
        return '-'.join(parts)
    surname = SURNAME_OVERRIDES.get(name[0], romanize_char(name[0]))
    given = ''.join(romanize_char(c) for c in name[1:])
    return f"{surname}-{given}"

# ---------- 공통 헬퍼 ----------
def clean(v):
    if v is None:
        return None
    if isinstance(v, float) and math.isnan(v):
        return None
    if isinstance(v, str) and v.strip() == "":
        return None
    return v

def parse_date(v):
    """8자리 숫자(20180116) -> '2018-01-16'. 형식이 다르면(예: '2017-07-??') 원문 그대로 유지."""
    v = clean(v)
    if v is None:
        return None
    s = str(int(v)) if isinstance(v, float) else str(v)
    if len(s) == 8 and s.isdigit():
        return f"{s[0:4]}-{s[4:6]}-{s[6:8]}"
    return s

def split_list(v):
    v = clean(v)
    if v is None:
        return []
    return [p.strip() for p in str(v).split(";") if p.strip()]

def derive_name_en(member_id):
    """id(예: kang-minji)에서 영문 표기(예: Minji Kang) 자동 유추 (성-이름 순서를 뒤집음)"""
    if not member_id:
        return None
    parts = member_id.split("-")
    return " ".join(p.capitalize() for p in reversed(parts))

def build_periods(row, columns):
    """joined_date/left_date(번호 붙은 것 포함)를 묶어서 활동 기간 배열로 변환.
    실제 컬럼명: joined_date(1번째는 번호 없음), left_date1, joined_date2, left_date2, ...
    예: joined_date, left_date1, joined_date2, left_date2 -> [{joined,left}, {joined,left}]"""
    joined_cols = sorted(
        [c for c in columns if re.fullmatch(r"joined_date\d*", c)],
        key=lambda c: int(re.sub(r"\D", "", c) or 1)
    )

    periods = []
    for jc in joined_cols:
        n = re.sub(r"\D", "", jc) or "1"
        lc = f"left_date{n}"  # 1번째 기간도 left_date1 (번호 있음)
        joined = parse_date(row.get(jc))
        left = parse_date(row.get(lc)) if lc in columns else None
        if joined is not None:
            periods.append({"joined": joined, "left": left})

    return periods

# ---------- 변환 ----------
df = pd.read_excel(SRC, sheet_name="artbeat_member", header=1)
df = df.drop(columns=[c for c in df.columns if str(c).startswith("Unnamed")])

# sns_* 와 platform_* 컬럼을 모두 찾아서, 접두사+끝자리 숫자를 뗀 플랫폼명으로 그룹핑
sns_cols = [c for c in df.columns if c.startswith("sns_") or c.startswith("platform_")]
platforms = {}
for col in sns_cols:
    platform = re.sub(r"^(sns_|platform_)", "", col)
    platform = re.sub(r"\d+$", "", platform)
    platforms.setdefault(platform, []).append(col)

members = []
generated_ids = []  # 자동 생성된 id 목록 (검수용)

for _, row in df.iterrows():
    name = clean(row.get("name"))
    if name is None:
        continue

    member_id = clean(row.get("id"))
    if member_id is None:
        member_id = generate_id(name)
        generated_ids.append((member_id, name))

    sns = {}
    for platform, cols in platforms.items():
        urls = [clean(row[c]) for c in cols]
        urls = [u for u in urls if u is not None]
        if urls:
            sns[platform] = urls

    periods = build_periods(row, df.columns)

    member = {
        "id": member_id,
        "name": name,
        "name_en": clean(row.get("name_en")) or derive_name_en(member_id),
        "birth_date": parse_date(row.get("date")),
        "gender": clean(row.get("gender")),
        "role": clean(row.get("role")),
        "unit": split_list(row.get("unit")),
        "status": clean(row.get("status")),
        "joined_date": periods[0]["joined"] if periods else None,
        "left_date": periods[-1]["left"] if periods else None,
        "membership_periods": periods,
        "photo_filename": clean(row.get("photo_filename")),
        "bio": clean(row.get("bio")),
        "sns": sns,
    }
    members.append(member)

OUT.parent.mkdir(parents=True, exist_ok=True)
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(members, f, ensure_ascii=False, indent=2)

print(f"{len(members)}명 변환 완료 -> {OUT}")
print(f"\n자동 생성된 id: {len(generated_ids)}개 (검수 권장)")
for gid, name in generated_ids:
    print(f"  {name} -> {gid}")
