from pathlib import Path
from xml.sax.saxutils import escape
from reportlab.pdfgen import canvas
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Image, PageBreak, Table, TableStyle, KeepTogether
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from PIL import Image as PILImage

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'docs/assets/object-reports-20261016'
OUTPUT = ROOT / 'output/pdf/WMS_오브젝트_변형과_파손_보고_교육.pdf'
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
pdfmetrics.registerFont(TTFont('Malgun', 'C:/Windows/Fonts/malgun.ttf'))
pdfmetrics.registerFont(TTFont('MalgunBold', 'C:/Windows/Fonts/malgunbd.ttf'))
pdfmetrics.registerFontFamily('Malgun', normal='Malgun', bold='MalgunBold', italic='Malgun', boldItalic='MalgunBold')
W, H = A4
CONTENT = W - 80
body = ParagraphStyle('body', fontName='Malgun', fontSize=10.4, leading=16.5, wordWrap='CJK', spaceAfter=7, textColor=colors.HexColor('#20262d'))
small = ParagraphStyle('small', parent=body, fontSize=8.6, leading=13.4, textColor=colors.HexColor('#52606d'), spaceAfter=8)
title = ParagraphStyle('title', parent=body, fontName='MalgunBold', fontSize=21, leading=29, spaceAfter=13, textColor=colors.black)
heading = ParagraphStyle('heading', parent=body, fontName='MalgunBold', fontSize=16, leading=23, spaceAfter=12, textColor=colors.black)
sub = ParagraphStyle('sub', parent=body, fontName='MalgunBold', fontSize=11.6, leading=18, spaceBefore=6, spaceAfter=7, textColor=colors.black)
warning = ParagraphStyle('warning', parent=body, fontName='MalgunBold', fontSize=11, leading=17.5, textColor=colors.HexColor('#b42318'), spaceAfter=10)
story = []

def p(text, style=body):
    story.append(Paragraph(text, style))

def step(n, text):
    p(f'<b>{n}.</b> {text}')

def picture(name, caption, max_height=330, max_width=CONTENT):
    path = ASSETS / name
    with PILImage.open(path) as im:
        iw, ih = im.size
    scale = min(max_width / iw, max_height / ih)
    image = Image(str(path), width=iw * scale, height=ih * scale)
    image.hAlign = 'CENTER'
    story.append(KeepTogether([Spacer(1, 3), image, Spacer(1, 5), Paragraph(caption, small)]))

def next_page():
    story.append(PageBreak())

p('WMS 오브젝트 사용과<br/>변형 및 파손 보고', title)
p('대상  오브젝트 사용자 및 물품관리자<br/>적용  2026년 10월 16일 운영 배포 기준', small)
p('오브젝트는 <b>등록 사진과 선택한 종류의 상태</b>를 기준으로 사용합니다. 변형은 작업 전 승인받고, 파손은 발견 즉시 사진과 함께 신고합니다. 실제 상태와 WMS 기록이 일치해야 다음 사용자가 올바른 물품을 받을 수 있습니다.')
p('보고 없이 몰래 반납하거나, 승인 없이 훼손·수리·폐기하는 행위를 금지합니다.', warning)
picture('01-live-login.png', '그림 1  운영 WMS 접속 화면. 사용자 업무는 대여자 로그인 후 진행합니다.', max_height=245)
p('반드시 지킬 원칙', sub)
step(1, '사용 전 물품 ID, 등록 사진, 종류와 구성품을 실물과 대조합니다.')
step(2, '자르기·도색·접착·분해·구성품 제거 등은 작은 변경이라도 먼저 승인받습니다.')
step(3, '반복 사용에 따른 마모·파손도 즉시 신고합니다. 반납할 때까지 기다리지 않습니다.')
step(4, '반납대나 선반에 두고 떠나는 것만으로 반납이 완료되지 않습니다. 관리자 확인과 WMS 처리가 필요합니다.')
p('이 문서의 신청·신고 화면은 교육용 계정과 예시 데이터로 재현했습니다. 실제 사용자의 기록과 운영 업로드 사진은 포함하지 않았습니다. 실제 신고에는 해당 오브젝트의 현재 상태 사진을 반드시 첨부하세요.', small)

next_page()
p('보고는 내 대여 조회에서 시작', heading)
p('WMS 메인에서 <b>내 대여 조회</b>를 엽니다. 기존 대여 목록에서 해당 물품 행의 <b>요청·신고</b> 버튼을 누르세요.')
picture('02-user-entry.png', 'WMS 메인에서 여는 내 대여 조회. 물품 행의 요청·신고 버튼으로 시작합니다.', max_height=320)
picture('09-report-chooser.png', '변형 요청 또는 지금 파손 신고를 선택합니다.', max_height=210)
p('접수한 내용과 관리자 답변은 목록 위 <b>요청·신고 내역</b>에서 확인합니다.')
next_page()
p('1 변형이 필요하면 작업 전에 요청', heading)
p('<b>내 대여 조회 → 해당 물품의 요청·신고 → 변형 요청</b>으로 이동합니다. 요청 접수만으로 변형을 시작할 수는 없습니다.')
picture('03-modification-request.png', '그림 2  변형 요청 입력 화면. 현재 상태 사진이 없으면 제출 버튼이 비활성화됩니다.', max_height=390, max_width=430)
step(1, '변형할 수량과 필요한 사유를 작성합니다.')
step(2, '변형할 부위·방법과 원상복구 가능 여부를 구체적으로 적습니다. 작업 전 현재 상태 사진을 첨부하고 제출합니다.')
step(3, '요청·신고 내역에서 <b>변형 승인</b> 상태와 관리자가 남긴 작업 범위를 확인한 뒤 작업합니다.')
step(4, '승인 범위가 바뀌면 다시 확인받습니다. 작업 후에는 완료 내용과 사진을 제출합니다.')
p('이미 무단으로 변형했다면 추가 작업을 멈추고 실제 작업 내용과 경위를 숨김없이 보고합니다. 사후 보고가 사전 승인으로 바뀌지는 않습니다.', warning)

next_page()
p('2 파손은 발견 즉시 사진과 함께 신고', heading)
p('<b>내 대여 조회 → 해당 물품의 요청·신고 → 지금 파손 신고</b>를 선택합니다. 사용 중 파손을 발견하면 먼저 사용을 중지하고, 부품이 분리되었다면 함께 보관합니다.')
picture('04-immediate-damage.png', '그림 3  사용 중 파손 신고 화면. 파손 수량·증상·발견 시점·경위와 사진을 제출합니다.', max_height=350, max_width=460)
p('신고 내용과 사진 기준', sub)
step(1, '실제 파손 수량과 증상을 적고, 언제 어떤 상황에서 발견했는지 설명합니다.')
step(2, '반복 사용에 따른 마모로 보이면 관찰한 상태를 적습니다. 원인을 모르면 원인 미상으로 적고 추정과 사실을 구분합니다.')
step(3, '대상 물품과 손상 부위가 식별되도록 <b>현재 상태 사진</b>을 촬영합니다. 등록 사진을 그대로 재사용하여 현재 상태를 대신해서는 안 됩니다.')
step(4, '제출 후 요청·신고 내역에서 접수 여부와 관리자 안내를 확인합니다. 오류가 나면 저장 여부를 먼저 확인한 뒤 재시도합니다.')
p('신고 접수는 반납 완료나 계속 사용 허가를 뜻하지 않습니다. 관리자 안내 전 임의 수리·추가 변형·폐기를 하지 마세요.', warning)

next_page()
p('3 관리자는 숫자 알림과 사진을 확인해 승인', heading)
p('<b>물품 관리 → 변형·파손 관리</b>에서 접수 건을 확인합니다. 접수 대기와 변형 완료 확인 대기 건은 사이드 메뉴 옆 숫자로 표시됩니다.')
picture('05b-notification-detail.png', '그림 4  사이드 메뉴의 숫자 알림. 메뉴를 눌러 대기 건을 확인합니다.', max_height=125, max_width=430)
picture('06-admin-review.png', '그림 5  관리자 검토 화면. 승인 범위 또는 반려 사유를 기록한 뒤 처리합니다.', max_height=260)
step(1, '물품 ID와 종류, 대상 수량, 등록 사진과 접수 사진을 대조합니다.')
step(2, '변형 요청은 필요한 사유·작업 범위·복구 가능 여부를 확인하고 <b>변형 승인</b> 또는 <b>반려</b>를 선택합니다. 검토 사유는 필수입니다.')
step(3, '파손 신고는 실제 상태를 확인해 조치 내용을 안내합니다. 신고 확인만으로 반납이나 재고 차감이 이루어지지는 않습니다.')
step(4, '실물을 인계받을 때는 정상 반납과 파손 반납을 구분하고, 신고 증빙 및 수량을 확인합니다.')

next_page()
p('4 보고 화면에서 SM 신규 등록', heading)
p('사용자는 승인된 요청의 <b>변형 완료 사진 제출</b>에서 실제 작업 내용과 완료 사진을 제출합니다. 관리자는 실물과 사진을 확인한 뒤 등록 방식을 확정합니다.')
picture('07-completion-registration.png', '그림 6  보고 화면의 SM 신규 등록. 이름과 속성 및 현재 상태 사진을 입력합니다.', max_height=300)
picture('10-sm-assigned-id.png', 'SM이 부여한 ID는 보고에 자동 연결됩니다.', max_height=80)
p('실제 상태에 따른 등록 방식', sub)
step(1, '<b>원상복구 후 기존 오브젝트 유지</b>는 등록 상태와 실물이 다시 일치하는 경우에 선택합니다.')
step(2, '<b>같은 오브젝트의 다른 종류로 등록</b>할 때는 시나리오 물품 관리에서 종류와 사진을 등록한 뒤 해당 종류를 선택합니다.')
step(3, '<b>별도 오브젝트로 등록</b>할 때는 이 보고 화면에서 이름·지역·위치·크기·속성과 사진을 입력하고 <b>Scenario Manager에 새 오브젝트 등록</b>을 누릅니다. SM이 부여한 ID가 자동 연결됩니다. 확인된 파손 신고에서도 가능합니다.')
p('새 물품은 <b>재고 0개</b>로 등록합니다. 실물 반납 후 원본과 대상 수량을 정리하고 사진·등록·재고 반영 확인란을 선택한 뒤 보고를 종료하세요. 등록 연결만으로 재고가 자동 이동하지는 않습니다.')

next_page()
p('5 파손 반납과 자동 페널티 및 면제', heading)
p('관리자는 <b>대여 및 반납 → 반납 처리</b>에서 물품을 담고 <b>파손?</b>을 선택합니다. 장바구니 처리 시 파손 수량을 지정한 뒤 불량 로그를 작성합니다.')
picture('08-penalty-exemption.png', '그림 7  파손 반납 중 페널티 면제 옵션. 기본은 자동 적용이며 면제 시 사유가 필요합니다.', max_height=205)
p('사전 미신고 시 적용되는 기준', sub)
p('같은 대여 건에 사진을 포함한 사전 신고가 있으면 신고된 수량을 한 번 확인합니다. <b>사전 신고되지 않은 파손 수량이 남으면 해당 대여 건당 한도를 5종 차감하고 14일간 적용</b>합니다. 반려된 신고는 인정되지 않습니다.')
table = Table([
    [Paragraph('<b>현재 대여 가능 종류</b>', body), Paragraph('<b>자동 페널티 후</b>', body), Paragraph('<b>적용 기간</b>', body)],
    [Paragraph('15종', body), Paragraph('10종', body), Paragraph('14일', body)],
    [Paragraph('3종', body), Paragraph('0종', body), Paragraph('14일', body)]
], colWidths=[CONTENT*.43, CONTENT*.34, CONTENT*.23])
table.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#e9eef4')),('GRID',(0,0),(-1,-1),.5,colors.HexColor('#d9d9d9')),('VALIGN',(0,0),(-1,-1),'MIDDLE'),('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),3)]))
story.append(table);story.append(Spacer(1,10))
p('여기서 5종은 물품 수량 5개를 뜻하지 않습니다. 여러 대여 건을 동시에 파손 반납하면 각 건을 별도로 판단하며, 한도는 0종 아래로 내려가지 않습니다.', small)
step(1, '관리자가 면제할 사유가 있다고 판단하면 <b>이 건은 자동 페널티를 부여하지 않음</b>을 선택하고 사유를 남깁니다. 무인 반납의 관리자 파손 확인에도 같은 기준이 적용됩니다.')
step(2, '정상적인 반복 사용에 따른 마모인지 등은 실물과 경위를 확인해 판단합니다. 사용자가 스스로 면제를 예상하고 신고를 생략해서는 안 됩니다.')
p('교육 확인', sub)
p('<b>등록 사진 기준 사용 → 변형 전 승인 → 파손 즉시 사진 신고 → 관리자 확인 후 반납.</b> 보고 없이 몰래 반납하거나 승인 없이 훼손·수리·폐기하는 행위는 허용되지 않습니다.', warning)

def footer(c: canvas.Canvas, doc):
    c.saveState();c.setFont('Malgun',8);c.setFillColor(colors.HexColor('#66727e'))
    c.drawString(40,25,'WMS 오브젝트 교육  |  2026.10.16')
    c.drawRightString(W-40,25,str(doc.page));c.restoreState()

document=SimpleDocTemplate(str(OUTPUT),pagesize=A4,rightMargin=40,leftMargin=40,topMargin=36,bottomMargin=44,title='WMS 오브젝트 사용과 변형 및 파손 보고',author='WMS')
document.build(story,onFirstPage=footer,onLaterPages=footer)
print(OUTPUT)
