import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

// 라벨은 실제 프린터(/dev/usb/lp0)로 보내기 전 같은 파이프라인으로 PNG까지 만들 수 있다.
// 운영 장부는 쓰지 않는다.
process.env.WMS_DB_PATH = ":memory:";
const { labelPreviewPng, fitPerson } = await import("./labelPrinter.js");

const LONG = [
  { name: "스테인리스 보온 텀블러 500ml 대용량 캠핑용 세트", quantity: 12, location: "B-11-4", variantName: "매트 블랙" },
  { name: "Samsonite Carry-on Luggage 20inch Hardcase", quantity: 105, location: "C-02-1", variantName: "" },
  { name: "가".repeat(60), quantity: 1, location: "위치 미등록 ".repeat(6), variantName: "" },
  { name: "원형 접시", quantity: 2, location: "A-03-2", variantName: "" },
  { name: "접이식 테이블", quantity: 4, location: "D-07-3", variantName: "" },
];

async function render(title, person, items) {
  const png = await labelPreviewPng(title, person, items);
  // PNG를 raw로 읽으면 채널이 여러 개일 수 있어 한 채널만 뽑아 (y*폭+x)로 바로 읽는다.
  const { data, info } = await sharp(png).extractChannel(0).raw().toBuffer({ resolveWithObject: true });
  return { data, info };
}

// 60×40mm = 480×320 dot. 프린터 명령 변환(bitmapCommand)이 이 크기가 아니면 출력을 거부한다.
test("라벨은 항상 480×320으로 그려진다(물품 1개~5개, 긴 이름 포함)", async () => {
  // 한 장에 담는 최대 개수(5개)까지 포함한다.
  for (const items of [[LONG[3]], LONG.slice(0, 2), LONG.slice(0, 4), LONG]) {
    const { info } = await render("한도 제외 물품", "홍길동 · 1234", items);
    assert.equal(info.width, 480);
    assert.equal(info.height, 320);
  }
});

// 회전 전 가로 방향이 회전 뒤에는 위·아래 가장자리가 된다. 긴 이름이 라벨 밖으로 번지면 여기에 잉크가 묻는다.
test("긴 이름도 위·아래 가장자리(회전 전 좌우 여백)를 넘지 않는다", async () => {
  const { data, info } = await render("반납 위치표", "아주아주아주긴이름의대여자 · 9999", LONG);
  const EDGE = 8;
  for (let y = 0; y < info.height; y++) {
    if (y >= EDGE && y < info.height - EDGE) continue;
    for (let x = 0; x < info.width; x++) {
      assert.ok(data[y * info.width + x] >= 128, `가장자리에 잉크가 있음: x=${x}, y=${y}`);
    }
  }
});

test("물품이 없어도 머리글만으로 그려진다", async () => {
  const { info } = await render("반납 위치표", "홍길동", []);
  assert.equal(info.width, 480);
});

// 같은 이름을 가려내는 건 사번이라, 이름이 길어 줄여야 해도 사번은 잘리면 안 된다.
test("대여자 이름이 길어도 사번 부분은 남기고 이름만 줄인다", () => {
  const long = fitPerson("아주아주아주아주아주긴이름의대여자 · 9999", 26, 18, 200);
  assert.ok(long.text.endsWith(" · 9999"), `사번이 잘림: ${long.text}`);
  assert.ok(long.text.includes("…"), "이름은 줄여졌어야 한다");
  assert.equal(long.size, 18);

  // 짧으면 그대로, 글자도 큰 채로 둔다.
  const short = fitPerson("홍길동 · 1234", 26, 18, 200);
  assert.equal(short.text, "홍길동 · 1234");
  assert.ok(short.size >= 22);

  // 사번 구분자가 없는 입력도 깨지지 않는다.
  assert.ok(fitPerson("아주아주아주아주아주긴이름의대여자", 26, 18, 120).text.length > 0);
});
