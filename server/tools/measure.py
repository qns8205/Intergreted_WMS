# -*- coding: utf-8 -*-
"""바닥에 붙인 체커보드를 기준으로 물품의 가로·세로를 재는 도구.

Node(server/routes/gas.js)에서 하위 프로세스로 부르고 결과는 JSON 한 줄로 돌려준다.
OpenCV는 시스템 파이썬이 아니라 tools/cv 가상환경에 있다(서버에 sudo apt를 쓸 수 없어
get-pip.py로 부트스트랩해서 설치했다).

  calibrate : 체커보드를 찾아 "이미지 좌표 -> 바닥 mm" 변환(호모그래피)을 구해 저장한다.
              카메라와 보드가 움직이지 않는 한 한 번만 하면 된다.
  measure   : 지금 화면 한 장만으로 보드 위 물건의 긴 변/짧은 변을 mm로 낸다.

■ 왜 "빈 바닥 기준 사진"과 비교하지 않는가
  처음엔 빈 바닥을 찍어두고 달라진 곳을 물체로 봤는데, 두 사진 사이 조명이 조금만 달라져도
  무너졌다. 그런데 물건을 올리고 내리려면 사람이 카메라 밑으로 들어가야 하고 그 자체가
  그림자를 만든다. 실측으로 확인한 실패들:
    - 비닐 반사가 움직여, 물건이 없는데 123mm짜리를 잡음
    - 자동노출 변화(평균밝기 171->152)로 보드 전체를 391x296mm 물체로 잡음
    - 사람이 비켜서며 생긴 그림자로 보드 절반이 물체로 잡힘
  그래서 과거 사진과 비교하지 않는다. 체커보드는 규칙적인 무늬라 "어디에 어떤 색이 있어야
  하는지"를 계산으로 알 수 있고, 거기서 어긋난 칸이 곧 물건이 덮은 자리다. 현재 프레임
  한 장만 보므로 조명·그림자·반사·자동노출 변화에 영향받지 않는다.

■ 한계
  - 보드 위에 올린 물건만 잰다(보드 밖은 기준 무늬가 없다).
  - 카메라가 하나라 높이는 못 잰다. 게다가 위에서 보면 물체의 윗면이 카메라에 더 가까워
    실제보다 크게 찍힌다. 높이를 알면 정확히 되돌릴 수 있어 --height로 받는다.
    보정 배율 = (카메라높이 - 물체높이) / 카메라높이.
"""
import argparse, json, sys, os, urllib.request
import numpy as np
import cv2

SQUARE_MM = 23.0
INNER = (15, 10)      # 16x11 칸 -> 내부 코너 15x10
COLS, ROWS = 16, 11   # 보드 전체 칸 수
PX_PER_MM = 2.0       # 정면 뷰 해상도 (0.5mm/px)
CELL_DEV = 0.30       # 칸 색이 대비 대비 이만큼 어긋나면 덮인 것으로 본다
MARGIN_MM = 40.0      # 보드 밖으로 조금 삐져나온 물건도 담기도록 정면 뷰에 두는 여유
STREAM = "http://127.0.0.1:3000/api/camera/stream?hq=1"
DATA_DIR = os.environ.get("WMS_MEASURE_DIR", "/var/wms/measure")
CALIB_PATH = os.path.join(DATA_DIR, "calibration.npz")

# 내부 코너 (0,0)을 기준으로 보드가 차지하는 범위(mm)
BX0, BY0 = -SQUARE_MM, -SQUARE_MM
BX1, BY1 = SQUARE_MM * (COLS - 1), SQUARE_MM * (ROWS - 1)
# 뷰는 보드 + 사방 여백. 보드 격자는 뷰 안에서 (OFF_X, OFF_Y) 만큼 밀린 자리에 있다.
OFF_X = int(round(MARGIN_MM * PX_PER_MM))
OFF_Y = OFF_X
BOARD_W = int(round((BX1 - BX0) * PX_PER_MM))
BOARD_H = int(round((BY1 - BY0) * PX_PER_MM))
VIEW_W = BOARD_W + 2 * OFF_X
VIEW_H = BOARD_H + 2 * OFF_Y


def out(**kw):
    print(json.dumps(kw, ensure_ascii=False))
    sys.exit(0 if kw.get("ok") else 1)


def grab(timeout=10):
    """MJPEG 스트림에서 완결된 JPEG 한 장을 꺼낸다."""
    buf = b""
    with urllib.request.urlopen(STREAM, timeout=timeout) as r:
        while len(buf) < 6_000_000:
            chunk = r.read(65536)
            if not chunk:
                break
            buf += chunk
            s = buf.find(b"\xff\xd8")
            e = buf.find(b"\xff\xd9", s + 2) if s >= 0 else -1
            if s >= 0 and e > 0:
                img = cv2.imdecode(np.frombuffer(buf[s:e + 2], np.uint8), cv2.IMREAD_COLOR)
                if img is not None:
                    return img
    raise RuntimeError("카메라 프레임을 받지 못했습니다")


def grab_sized(w, h, tries=6):
    """스트림이 고해상도로 바뀌는 데 잠깐 걸려 기본 해상도 프레임이 올 때가 있다."""
    for _ in range(tries):
        img = grab()
        if (img.shape[1], img.shape[0]) == (w, h):
            return img
    return None


def _variants(gray):
    """비닐 반사 때문에 프레임마다 검출이 되기도 하고 안 되기도 해서 여러 전처리를 돌린다."""
    yield gray
    yield cv2.medianBlur(gray, 5)   # 작고 밝은 반사 얼룩을 잘 지운다
    yield (np.power(gray / 255.0, 1.8) * 255).astype(np.uint8)
    yield cv2.createCLAHE(3.0, (8, 8)).apply(cv2.GaussianBlur(gray, (5, 5), 0))


def find_board(tries=12):
    for _ in range(tries):
        img = grab()
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        for g in _variants(gray):
            try:
                ok, corners = cv2.findChessboardCornersSB(
                    g, INNER, cv2.CALIB_CB_EXHAUSTIVE | cv2.CALIB_CB_ACCURACY)
            except Exception:
                ok = False
            if ok:
                corners = cv2.cornerSubPix(
                    gray, corners.astype(np.float32), (11, 11), (-1, -1),
                    (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 40, 0.001))
                return img, corners
    return None, None


def board_to_view():
    """보드 mm 좌표 -> 정면 뷰 픽셀 좌표 (원점을 좌상단으로 옮기고 확대)."""
    return np.array([[PX_PER_MM, 0, -BX0 * PX_PER_MM + OFF_X],
                     [0, PX_PER_MM, -BY0 * PX_PER_MM + OFF_Y],
                     [0, 0, 1]], np.float32)


def _cell_means(gray_view):
    """정면 뷰를 16x11 칸으로 나눠 각 칸 안쪽(가장자리 제외) 평균 밝기를 낸다."""
    cw, ch = BOARD_W / COLS, BOARD_H / ROWS
    inset = 0.25  # 칸 경계는 흐릿하니 안쪽 절반만 본다
    means = np.zeros((ROWS, COLS), np.float32)
    for j in range(ROWS):
        for i in range(COLS):
            x0, x1 = OFF_X + int((i + inset) * cw), OFF_X + int((i + 1 - inset) * cw)
            y0, y1 = OFF_Y + int((j + inset) * ch), OFF_Y + int((j + 1 - inset) * ch)
            means[j, i] = gray_view[y0:y1, x0:x1].mean()
    return means


def _detect_parity(means):
    """(i+j)가 짝수인 칸이 검은색이면 0, 홀수면 1. 인쇄물마다 시작 색이 달라 실제로 보고 정한다.
    물건이 몇 칸을 덮고 있어도 흔들리지 않도록 평균이 아니라 중앙값으로 본다."""
    jj, ii = np.mgrid[0:ROWS, 0:COLS]
    even = float(np.median(means[(ii + jj) % 2 == 0]))
    odd = float(np.median(means[(ii + jj) % 2 == 1]))
    return 0 if even < odd else 1


def do_calibrate():
    os.makedirs(DATA_DIR, exist_ok=True)
    img, corners = find_board()
    if corners is None:
        out(ok=False, message="체커보드를 찾지 못했습니다. 보드가 가려졌거나 조명 반사가 심한지 확인해주세요.")

    objp = np.zeros((INNER[0] * INNER[1], 2), np.float32)
    objp[:, :2] = np.mgrid[0:INNER[0], 0:INNER[1]].T.reshape(-1, 2)
    objp *= SQUARE_MM

    H, mask = cv2.findHomography(corners.reshape(-1, 2), objp, cv2.RANSAC, 2.0)
    if H is None:
        out(ok=False, message="좌표 변환을 계산하지 못했습니다.")

    proj = cv2.perspectiveTransform(corners.reshape(-1, 1, 2), H).reshape(-1, 2)
    err = float(np.linalg.norm(proj - objp, axis=1).mean())

    h, w = img.shape[:2]
    p = cv2.perspectiveTransform(np.array([[[w / 2, h / 2], [w / 2 + 100, h / 2]]], np.float32), H)[0]
    mm_per_px = float(np.linalg.norm(p[1] - p[0]) / 100)

    view = cv2.warpPerspective(img, board_to_view() @ H, (VIEW_W, VIEW_H))
    parity = _detect_parity(_cell_means(cv2.cvtColor(view, cv2.COLOR_BGR2GRAY)))

    np.savez(CALIB_PATH, H=H, mm_per_px=mm_per_px, size=np.array([w, h]), parity=parity)
    out(ok=True, mmPerPx=round(mm_per_px, 4), reprojErrMm=round(err, 3),
        corners=int(mask.sum()), cornersTotal=int(len(mask)), parity=int(parity),
        boardMm=[round(BX1 - BX0), round(BY1 - BY0)],
        message="보정 완료. 이제 기준 사진 없이 측정합니다.")


def do_measure(height_mm, cam_height_mm, min_area_mm2, debug_path):
    if not os.path.exists(CALIB_PATH):
        out(ok=False, message="먼저 카메라 보정을 해주세요.")
    z = np.load(CALIB_PATH)
    H = z["H"]
    w, h = [int(v) for v in z["size"]]

    img = grab_sized(w, h)
    if img is None:
        out(ok=False, message="카메라가 고해상도 화면을 내려주지 못했습니다. 잠시 후 다시 시도해주세요.")

    # 보드를 정면에서 본 모습으로 편다. 이 뷰에서는 1px = 0.5mm라 길이를 바로 mm로 읽는다.
    view = cv2.warpPerspective(img, board_to_view() @ H, (VIEW_W, VIEW_H))
    gray = cv2.cvtColor(view, cv2.COLOR_BGR2GRAY)
    means = _cell_means(gray)

    # 흑백 배치는 매번 이 프레임에서 직접 판정한다(보정 파일에 의존하지 않는다).
    jj, ii = np.mgrid[0:ROWS, 0:COLS]
    expect_black = ((ii + jj) % 2 == _detect_parity(means))

    # 정상적인 검정/흰색 수준을 이 프레임 안에서 직접 구한다. 단, 보드 전체를 하나의 값으로
    # 잡으면 조명이 위치마다 다를 때(그림자·비네팅) 멀쩡한 칸까지 어긋난 것으로 나온다
    # (실측: 149/176칸이 덮였다고 나왔다). 그래서 각 칸마다 "주변 칸"으로 기준을 세운다.
    # 주변 중앙값이라 물건이 덮은 칸 몇 개에는 휘둘리지 않는다.
    R = 3  # 주변 몇 칸까지 볼지
    blk_map = np.zeros_like(means)
    wht_map = np.zeros_like(means)
    for j in range(ROWS):
        for i in range(COLS):
            j0, j1 = max(0, j - R), min(ROWS, j + R + 1)
            i0, i1 = max(0, i - R), min(COLS, i + R + 1)
            win, wb = means[j0:j1, i0:i1], expect_black[j0:j1, i0:i1]
            blk_map[j, i] = np.median(win[wb]) if wb.any() else np.median(win)
            wht_map[j, i] = np.median(win[~wb]) if (~wb).any() else np.median(win)

    contrast = wht_map - blk_map
    if float(np.median(contrast)) < 20:
        out(ok=False, message="체커보드 무늬가 잘 안 보입니다. 보드가 가려졌거나 너무 어둡습니다.")
    contrast = np.maximum(contrast, 20)

    expected = np.where(expect_black, blk_map, wht_map)
    covered = (np.abs(means - expected) / contrast) > CELL_DEV
    if not covered.any():
        out(ok=False, message="보드 위에서 물품을 찾지 못했습니다. 물건을 보드 안에 올려주세요.")

    # 반사로 한두 칸이 튀는 경우를 배제하려고 가장 큰 덩어리만 남긴다
    n, lab, stats, _ = cv2.connectedComponentsWithStats(covered.astype(np.uint8), 8)
    if n <= 1:
        out(ok=False, message="보드 위에서 물품을 찾지 못했습니다.")
    covered = (lab == 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA])))

    # 칸 단위(23mm)로는 너무 거칠다. GrabCut으로 실제 물체 경계까지 다듬는다.
    #   확실한 전경 = 덮인 칸을 안쪽으로 깎은 부분 / 확실한 배경 = 안 덮인 칸을 깎은 부분
    board_cells = cv2.resize(covered.astype(np.uint8) * 255, (BOARD_W, BOARD_H), interpolation=cv2.INTER_NEAREST)
    cell = np.zeros((VIEW_H, VIEW_W), np.uint8)
    cell[OFF_Y:OFF_Y + BOARD_H, OFF_X:OFF_X + BOARD_W] = board_cells

    cpx = int(SQUARE_MM * PX_PER_MM)          # 한 칸의 픽셀 크기
    # 덮였다고 판정된 칸은 물체보다 작게 잡힌다(칸을 절반만 덮으면 판정을 못 넘는다).
    # 그래서 한 칸 넓힌 영역까지 "전경일 수도 있음"으로 두고, 진짜 경계는 GrabCut이 찾게 한다.
    grow = cv2.dilate(cell, np.ones((cpx, cpx), np.uint8))
    sure_fg = cv2.erode(cell, np.ones((int(cpx * 0.6),) * 2, np.uint8))
    sure_bg = cv2.erode(255 - grow, np.ones((cpx, cpx), np.uint8))

    gc = np.full((VIEW_H, VIEW_W), cv2.GC_PR_BGD, np.uint8)
    gc[grow > 0] = cv2.GC_PR_FGD
    gc[sure_bg > 0] = cv2.GC_BGD
    gc[sure_fg > 0] = cv2.GC_FGD
    if not (gc == cv2.GC_FGD).any() or not (gc == cv2.GC_BGD).any():
        out(ok=False, message="물품이 너무 크거나 작아 경계를 잡지 못했습니다.")
    try:
        cv2.grabCut(view, gc, None, np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64),
                    3, cv2.GC_INIT_WITH_MASK)
    except Exception as e:
        out(ok=False, message=f"경계 다듬기에 실패했습니다: {e}")

    m = np.where((gc == cv2.GC_FGD) | (gc == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((7, 7), np.uint8))
    cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        out(ok=False, message="물품 경계를 찾지 못했습니다.")
    c = max(cnts, key=cv2.contourArea)

    (_, _), (rw, rh), ang = cv2.minAreaRect(c)
    long_mm, short_mm = max(rw, rh) / PX_PER_MM, min(rw, rh) / PX_PER_MM
    if long_mm * short_mm < min_area_mm2:
        out(ok=False, message="찾은 영역이 너무 작아 물품으로 보기 어렵습니다.")

    corrected = False
    if height_mm and 0 < height_mm < cam_height_mm:
        k2 = (cam_height_mm - height_mm) / cam_height_mm
        long_mm, short_mm, corrected = long_mm * k2, short_mm * k2, True

    if debug_path:
        vis = view.copy()
        cv2.drawContours(vis, [c], -1, (0, 0, 255), 2)
        cv2.polylines(vis, [cv2.boxPoints(cv2.minAreaRect(c)).astype(np.int32)], True, (0, 200, 255), 1)
        cv2.imwrite(debug_path, vis)

    out(ok=True, longMm=round(float(long_mm), 1), shortMm=round(float(short_mm), 1),
        heightMm=height_mm or None, corrected=corrected,
        coveredCells=int(covered.sum()), angleDeg=round(float(ang), 1))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["calibrate", "measure"])
    ap.add_argument("--height", type=float, default=0)
    ap.add_argument("--cam-height", type=float, default=900)
    ap.add_argument("--min-area", type=float, default=400)
    ap.add_argument("--debug", default="")
    a = ap.parse_args()
    try:
        if a.mode == "calibrate":
            do_calibrate()
        else:
            do_measure(a.height, a.cam_height, a.min_area, a.debug)
    except SystemExit:
        raise
    except Exception as e:
        out(ok=False, message=f"측정 중 오류: {e}")
