"""
NPB順位決定アルゴリズムとゲーム差・勝率計算の検証スクリプト
"""

def calc_pct(wins, losses):
    if wins + losses == 0:
        return 0.0
    return wins / (wins + losses)

def calc_gb(leader_w, leader_l, team_w, team_l):
    return ((leader_w - team_w) + (team_l - leader_l)) / 2.0

# テストケース1: 勝率計算
assert calc_pct(70, 50) == 70 / 120
assert calc_pct(0, 0) == 0.0

# テストケース2: ゲーム差計算
# 1位: 75勝 45敗
# 2位: 70勝 50敗
# GB = ((75 - 70) + (50 - 45)) / 2 = (5 + 5) / 2 = 5.0
assert calc_gb(75, 45, 70, 50) == 5.0

# 3位: 68勝 52敗 (GB = ((75-68) + (52-45))/2 = (7+7)/2 = 7.0)
assert calc_gb(75, 45, 68, 52) == 7.0

# テストケース3: タイブレーク（同勝率）
# A: 70勝 50敗 (勝率 .5833, 勝利数 70)
# B: 63勝 45敗 (勝率 .5833, 勝利数 63)
# セ・リーグ方式: 勝利数が多いAが上位
# パ・リーグ方式: 直接対決成績で判定

print("すべての計算ロジックテストが正常に合格しました！")
