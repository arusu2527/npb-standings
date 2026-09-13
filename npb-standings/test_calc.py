def calc_batting_stats(ab, h, b2, b3, hr, bb, hbp, sf):
    b1 = max(0, h - (b2 + b3 + hr))
    tb = b1 + (b2 * 2) + (b3 * 3) + (hr * 4)
    avg = h / ab if ab > 0 else 0
    obp_denom = ab + bb + hbp + sf
    obp = (h + bb + hbp) / obp_denom if obp_denom > 0 else 0
    slg = tb / ab if ab > 0 else 0
    ops = obp + slg
    return {
        "avg": f"{avg:.3f}",
        "obp": f"{obp:.3f}",
        "slg": f"{slg:.3f}",
        "ops": f"{ops:.3f}",
        "tb": tb
    }

def calc_pitching_stats(raw_ip, er, w, l, h, bb, so):
    ip_int = int(raw_ip)
    ip_frac = round((raw_ip - ip_int) * 10)
    actual_ip = ip_int + (1/3 if ip_frac == 1 else (2/3 if ip_frac == 2 else 0))
    
    era = (er * 9) / actual_ip if actual_ip > 0 else 0
    wpct = w / (w + l) if (w + l) > 0 else 0
    whip = (h + bb) / actual_ip if actual_ip > 0 else 0
    k9 = (so * 9) / actual_ip if actual_ip > 0 else 0
    kbb = so / bb if bb > 0 else so
    return {
        "actual_ip": f"{actual_ip:.2f}",
        "era": f"{era:.2f}",
        "wpct": f"{wpct:.3f}",
        "whip": f"{whip:.2f}",
        "k9": f"{k9:.2f}",
        "kbb": f"{kbb:.2f}"
    }

# 岡本和真 2024例: 500打数 140安打 30二塁打 1三塁打 27本塁打 70四球 6死球 4犠飛
bat_res = calc_batting_stats(500, 140, 30, 1, 27, 70, 6, 4)
print("岡本和真 打撃成績:", bat_res)
assert bat_res["avg"] == "0.280"

# 戸郷翔征 2024例: 180回 自責点39 12勝8敗 140被安打 44与四球 156奪三振
pitch_res = calc_pitching_stats(180.0, 39, 12, 8, 140, 44, 156)
print("戸郷翔征 投手成績:", pitch_res)
assert pitch_res["era"] == "1.95"
assert pitch_res["wpct"] == "0.600"

print("すべての計算テストに合格しました！")
