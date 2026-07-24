import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';

// 프론트엔드(Vercel) 배포 감지용 빌드 ID.
// Vercel은 빌드 시 VERCEL_GIT_COMMIT_SHA(커밋 해시)를 자동으로 넣어주므로 이를 우선 사용하고,
// 로컬 빌드 등 커밋 해시가 없는 환경에서는 빌드 시각을 대신 사용한다.
// 이 값은 ① JS 번들 안에(import.meta.env.VITE_BUILD_ID) ② dist/build-version.json 정적 파일에
// 동일하게 기록되어, 실행 중인 탭(번들에 박힌 값)과 서버의 최신 정적 파일을 비교하는 데 쓰인다.
const BUILD_ID =
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.GITHUB_SHA ||
  String(Date.now());

// 빌드가 끝난 뒤 dist 폴더에 build-version.json을 써 넣는 플러그인.
// (public 폴더 복사 타이밍에 의존하지 않도록 closeBundle에서 직접 기록)
function writeBuildVersionPlugin() {
  return {
    name: 'write-build-version',
    apply: 'build' as const,
    closeBundle() {
      try {
        const outDir = path.resolve(__dirname, 'dist');
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(
          path.join(outDir, 'build-version.json'),
          JSON.stringify({ buildId: BUILD_ID, builtAt: new Date().toISOString() }, null, 2),
        );
      } catch (e) {
        console.warn('[build-version] build-version.json 기록 실패:', e);
      }
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), writeBuildVersionPlugin()],
    define: {
      'import.meta.env.VITE_BUILD_ID': JSON.stringify(BUILD_ID),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
