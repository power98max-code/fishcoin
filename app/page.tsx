"use client";

export default function Home() {
  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center px-6">
      <div className="max-w-2xl text-center">
        <h1 className="text-5xl font-bold text-emerald-400 mb-8">
          FISH COIN EXCHANGE
        </h1>

        <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-8">
          <h2 className="text-3xl font-bold mb-6">
            서비스 종료 안내
          </h2>

          <p className="text-zinc-300 leading-8">
            안녕하세요.
            <br />
            <br />
            지금까지 FISH COIN EXCHANGE를 이용해주신 모든 분들께
            진심으로 감사드립니다.
            <br />
            <br />
            본 서비스는 여기서 운영을 종료하게 되었습니다.
            <br />
            처음 만드는 것이라 부족한 점도 많았지만,
            여러분들의 피드백을 통해 많은 것을 배웠습니다.
            <br />
            <br />
            미숙한 점을 보완하고 더 공부하여
            <span className="text-emerald-400 font-bold">
              {" "}시즌 2
            </span>
            로 다시 찾아뵙겠습니다.
            <br />
            <br />
            그동안 함께해 주셔서 감사합니다.
          </p>

          <div className="mt-8 text-emerald-400 font-bold text-xl">
            SEE YOU IN SEASON 2
          </div>
        </div>
      </div>
    </div>
  );
}