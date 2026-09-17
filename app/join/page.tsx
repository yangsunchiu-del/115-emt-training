"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://wlnzstgskyolvrxjlagb.supabase.co",
  "sb_publishable_RfGKc6tWCWVwhj3nPM_dDw_YhfPEChc"
);

export default function JoinPage() {
  const [studentNumber, setStudentNumber] = useState("");
  const [name, setName] = useState("");
  const [nickname, setNickname] = useState("");
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [joined, setJoined] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const [session, setSession] = useState<any>(null);
  const [question, setQuestion] = useState<any>(null);

  const [selectedAnswer, setSelectedAnswer] = useState("");
  const [answerSubmitted, setAnswerSubmitted] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(15);

  const [recentNicknames, setRecentNicknames] = useState<string[]>([]);

  async function loadCount() {
    const { count, error } = await supabase
      .from("participants")
      .select("*", { count: "exact", head: true });

    if (!error && count !== null) {
      setCount(count);
    }
  }

  async function loadRecentNicknames() {
    const { data, error } = await supabase
      .from("participants")
      .select("nickname")
      .not("nickname", "is", null)
      .neq("nickname", "")
      .order("id", { ascending: false })
      .limit(5);

    if (!error && data) {
      setRecentNicknames(
        data
          .map((item: any) => item.nickname)
          .filter((item: string | null) => Boolean(item))
      );
    }
  }

  function logoutLocalStudent() {
    localStorage.removeItem("participant_id");
    localStorage.removeItem("student_number");
    localStorage.removeItem("participant_name");
    localStorage.removeItem("participant_nickname");

    setJoined(false);
    setStudentNumber("");
    setName("");
    setNickname("");
    setSelectedAnswer("");
    setAnswerSubmitted(false);
    setQuestion(null);

    setErrorMessage(
      "教官已重設本梯次，請重新輸入編號與姓名報到。"
    );
  }

  async function validateParticipant() {
    const participantId = localStorage.getItem("participant_id");

    if (!participantId) return;

    const { data, error } = await supabase
      .from("participants")
      .select("id, student_number, name, nickname")
      .eq("id", Number(participantId))
      .maybeSingle();

    if (error) return;

    if (!data) {
      logoutLocalStudent();
      return;
    }

    setJoined(true);
    setStudentNumber(data.student_number ?? "");
    setName(data.name ?? "");
    setNickname(data.nickname ?? "");
  }

  async function restoreStudent() {
    const participantId = localStorage.getItem("participant_id");
    const savedNumber = localStorage.getItem("student_number");
    const savedName = localStorage.getItem("participant_name");
    const savedNickname =
      localStorage.getItem("participant_nickname") ?? "";

    if (!participantId || !savedNumber || !savedName) {
      setJoined(false);
      return;
    }

    const { data, error } = await supabase
      .from("participants")
      .select("id, nickname")
      .eq("id", Number(participantId))
      .maybeSingle();

    if (error || !data) {
      logoutLocalStudent();
      return;
    }

    setStudentNumber(savedNumber);
    setName(savedName);
    setNickname(data.nickname ?? savedNickname);
    setJoined(true);
  }

  async function checkExistingAnswer(questionId: number) {
    const participantId = localStorage.getItem("participant_id");

    if (!participantId) return;

    const { data, error } = await supabase
      .from("answers")
      .select("answer")
      .eq("participant_id", Number(participantId))
      .eq("question_id", questionId)
      .maybeSingle();

    if (!error && data) {
      setSelectedAnswer(data.answer);
      setAnswerSubmitted(true);
    }
  }

  async function loadQuestion(questionId: number) {
    const { data, error } = await supabase
      .from("questions")
      .select("*")
      .eq("id", questionId)
      .single();

    if (!error && data) {
      setQuestion((old: any) => {
        if (!old || old.id !== data.id) {
          setSelectedAnswer("");
          setAnswerSubmitted(false);
          checkExistingAnswer(data.id);
        }

        return data;
      });
    }
  }

  async function loadSession() {
    const { data, error } = await supabase
      .from("session_state")
      .select("*")
      .eq("id", 1)
      .single();

    if (error || !data) return;

    setSession(data);

    if (data.current_question_id) {
      await loadQuestion(data.current_question_id);
    } else {
      setQuestion(null);
      setSelectedAnswer("");
      setAnswerSubmitted(false);
    }
  }

  useEffect(() => {
    restoreStudent();
    loadCount();
    loadRecentNicknames();
    loadSession();

    const participantChannel = supabase
      .channel("join-participants-nickname")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "participants",
        },
        () => {
          loadCount();
          loadRecentNicknames();
          validateParticipant();
        }
      )
      .subscribe();

    const sessionChannel = supabase
      .channel("join-session-nickname")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "session_state",
        },
        () => {
          loadSession();
        }
      )
      .subscribe();

    const poller = setInterval(() => {
      loadSession();
      validateParticipant();
    }, 3000);

    return () => {
      clearInterval(poller);
      supabase.removeChannel(participantChannel);
      supabase.removeChannel(sessionChannel);
    };
  }, []);

  useEffect(() => {
    if (!session || !question) return;

    if (session.status !== "active") {
      if (
        session.status === "locked" ||
        session.status === "revealed"
      ) {
        setSecondsLeft(0);
      }
      return;
    }

    if (!session.question_started_at) return;

    const updateTimer = () => {
      const startedAt = new Date(
        session.question_started_at
      ).getTime();

      const durationMs = (question.duration ?? 15) * 1000;

      const remaining = Math.max(
        0,
        Math.ceil(
          (startedAt + durationMs - Date.now()) / 1000
        )
      );

      setSecondsLeft(remaining);
    };

    updateTimer();

    const timer = setInterval(updateTimer, 250);

    return () => clearInterval(timer);
  }, [session, question]);

  async function handleJoin() {
    const cleanNumber = studentNumber.trim();
    const cleanName = name.trim();
    const cleanNickname = nickname.trim();

    if (!cleanNumber || !cleanName) {
      setErrorMessage("請輸入編號與姓名");
      return;
    }

    setLoading(true);
    setErrorMessage("");

    const { data, error } = await supabase
      .from("participants")
      .insert({
        student_number: cleanNumber,
        name: cleanName,
        nickname: cleanNickname || null,
      })
      .select()
      .single();

    setLoading(false);

    if (error) {
      if (error.code === "23505") {
        setErrorMessage("這個編號已經完成報到");
      } else {
        console.error(error);
        setErrorMessage("報到失敗，請再試一次");
      }
      return;
    }

    localStorage.setItem("participant_id", String(data.id));
    localStorage.setItem("student_number", cleanNumber);
    localStorage.setItem("participant_name", cleanName);
    localStorage.setItem("participant_nickname", cleanNickname);

    setJoined(true);

    await loadCount();
    await loadRecentNicknames();
    await loadSession();
  }

  async function submitAnswer(answer: string) {
    if (
      !question ||
      answerSubmitted ||
      session?.status !== "active" ||
      secondsLeft <= 0
    ) {
      return;
    }

    const participantId =
      localStorage.getItem("participant_id");

    if (!participantId) {
      logoutLocalStudent();
      return;
    }

    setSelectedAnswer(answer);

    const { error } = await supabase
      .from("answers")
      .insert({
        participant_id: Number(participantId),
        question_id: question.id,
        answer,
      });

    if (error) {
      if (error.code === "23505") {
        setAnswerSubmitted(true);
      } else {
        console.error(error);
        setErrorMessage("答案送出失敗，請再試一次");
      }
      return;
    }

    setAnswerSubmitted(true);
  }

  function answerStyle(letter: string) {
    const base =
      "w-full rounded-2xl border p-5 text-left text-xl transition";

    if (session?.status === "revealed") {
      if (question?.correct_answer === letter) {
        return `${base} border-green-500 bg-green-500/15 text-green-300`;
      }

      if (
        selectedAnswer === letter &&
        question?.correct_answer !== letter
      ) {
        return `${base} border-red-500 bg-red-500/15 text-red-300`;
      }

      return `${base} border-zinc-800 bg-zinc-950 text-zinc-500`;
    }

    if (selectedAnswer === letter) {
      return `${base} border-blue-500 bg-blue-500/15`;
    }

    return `${base} border-zinc-800 bg-zinc-950 hover:border-blue-500`;
  }

  // =========================
  // 尚未報到
  // =========================

  if (!joined) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black px-6 py-10 text-white">
        <div className="w-full max-w-xl">

          <p className="text-center text-sm tracking-[0.3em] text-zinc-500">
            115年 第四次替代役招訓
          </p>

          <h1 className="mt-5 text-center text-4xl font-semibold">
            EMT 複訓
          </h1>

          <div className="mt-10 rounded-3xl border border-zinc-800 bg-zinc-950 p-8">

            <div className="text-center">
              <div className="text-sm tracking-[0.2em] text-zinc-500">
                CURRENT
              </div>

              <div className="mt-2 text-4xl font-semibold">
                <span className="text-blue-500">
                  {count}
                </span>

                <span className="text-zinc-600">
                  {" "} / 300
                </span>
              </div>

              <p className="mt-2 text-sm text-zinc-500">
                目前報到人數
              </p>
            </div>

            <div className="mt-8 space-y-4">

              <input
                value={studentNumber}
                onChange={(e) =>
                  setStudentNumber(e.target.value)
                }
                placeholder="編號"
                className="w-full rounded-2xl border border-zinc-800 bg-black px-5 py-4 text-lg outline-none focus:border-blue-500"
              />

              <input
                value={name}
                onChange={(e) =>
                  setName(e.target.value)
                }
                placeholder="姓名"
                className="w-full rounded-2xl border border-zinc-800 bg-black px-5 py-4 text-lg outline-none focus:border-blue-500"
              />

              <input
                value={nickname}
                onChange={(e) =>
                  setNickname(e.target.value)
                }
                placeholder="好笑小名 😂（選填）"
                maxLength={20}
                className="w-full rounded-2xl border border-zinc-800 bg-black px-5 py-4 text-lg outline-none focus:border-blue-500"
              />

              <p className="px-2 text-sm text-zinc-600">
                小名會出現在等待區，真實姓名不會公開。
              </p>

              <button
                onClick={handleJoin}
                disabled={loading}
                className="w-full rounded-full bg-blue-500 px-6 py-5 text-xl font-semibold hover:bg-blue-400 disabled:opacity-50"
              >
                {loading
                  ? "報到中..."
                  : "完成報到 →"}
              </button>
            </div>

            {errorMessage && (
              <div className="mt-5 rounded-2xl border border-orange-500/30 bg-orange-500/10 p-4 text-center text-orange-200">
                {errorMessage}
              </div>
            )}

          </div>
        </div>
      </main>
    );
  }

  // =========================
  // 等待教官
  // =========================

  if (
    !session ||
    session.status === "waiting" ||
    !question
  ) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black px-6 py-10 text-white">

        <div className="w-full max-w-2xl text-center">

          <p className="text-sm tracking-[0.3em] text-zinc-500">
            CHECK-IN COMPLETE
          </p>

          <h1 className="mt-5 text-5xl font-semibold">
            報到完成
          </h1>

          <p className="mt-5 text-xl text-zinc-400">
            {studentNumber}　{name}
          </p>

          {nickname && (
            <div className="mt-4">
              <span className="rounded-full border border-blue-500/30 bg-blue-500/10 px-5 py-2 text-blue-300">
                😂 {nickname}
              </span>
            </div>
          )}

          <div className="mt-10 rounded-3xl border border-zinc-800 bg-zinc-950 p-10">

            <div className="mx-auto h-3 w-3 animate-pulse rounded-full bg-blue-500" />

            <p className="mt-6 text-2xl">
              等待教官開始
            </p>

            <div className="mt-8">
              <div className="text-sm tracking-[0.2em] text-zinc-500">
                PARTICIPANTS
              </div>

              <div className="mt-2 text-5xl font-semibold">
                <span className="text-blue-500">
                  {count}
                </span>

                <span className="text-zinc-700">
                  {" "} / 300
                </span>
              </div>

              <p className="mt-3 text-zinc-500">
                人已完成報到
              </p>
            </div>

          </div>

          {recentNicknames.length > 0 && (
            <div className="mt-6 rounded-3xl border border-zinc-800 bg-zinc-950 p-7">

              <p className="text-sm tracking-[0.2em] text-zinc-500">
                👀 WHO'S HERE?
              </p>

              <h2 className="mt-3 text-2xl font-semibold">
                好笑的小名被發現了
              </h2>

              <div className="mt-6 space-y-3">

                {recentNicknames.map(
                  (item, index) => (
                    <div
                      key={`${item}-${index}`}
                      className="rounded-2xl border border-zinc-800 bg-black px-5 py-4 text-lg"
                    >
                      <span className="mr-2">
                        {index === 0
                          ? "😂"
                          : index === 1
                          ? "👀"
                          : index === 2
                          ? "🚑"
                          : index === 3
                          ? "⚡"
                          : "🤣"}
                      </span>

                      <span className="font-semibold text-blue-300">
                        「{item}」
                      </span>

                      <span className="text-zinc-400">
                        {" "}被發現了！
                      </span>
                    </div>
                  )
                )}

              </div>
            </div>
          )}

        </div>
      </main>
    );
  }

  // =========================
  // 題目畫面
  // =========================

  const revealed =
    session.status === "revealed";

  const locked =
    session.status === "locked";

  const isCorrect =
    selectedAnswer &&
    selectedAnswer === question.correct_answer;

  return (
    <main className="min-h-screen bg-black px-6 py-8 text-white">

      <div className="mx-auto max-w-3xl">

        <div className="flex items-center justify-between gap-4">

          <div>
            <p className="text-sm tracking-[0.2em] text-zinc-500">
              EMT TRAINING
            </p>

            <p className="mt-2 text-zinc-400">
              {studentNumber}　{name}
            </p>
          </div>

          <div className="text-right">

            <div className="text-4xl font-semibold">
              {secondsLeft}s
            </div>

            <div className="mt-1 text-sm text-zinc-500">
              Q{question.question_number}
            </div>

          </div>
        </div>

        <div className="mt-8 rounded-3xl border border-zinc-800 bg-zinc-950 p-7">

          <h1 className="text-3xl font-semibold leading-relaxed">
            {question.question}
          </h1>

          <div className="mt-8 space-y-4">

            {(["A", "B", "C", "D"] as const).map(
              (letter) => {

                const option =
                  letter === "A"
                    ? question.option_a
                    : letter === "B"
                    ? question.option_b
                    : letter === "C"
                    ? question.option_c
                    : question.option_d;

                return (
                  <button
                    key={letter}
                    onClick={() =>
                      submitAnswer(letter)
                    }
                    disabled={
                      answerSubmitted ||
                      locked ||
                      revealed ||
                      secondsLeft <= 0
                    }
                    className={answerStyle(letter)}
                  >

                    <span className="mr-4 font-semibold text-blue-500">
                      {letter}
                    </span>

                    {option}

                  </button>
                );
              }
            )}

          </div>
        </div>

        {answerSubmitted &&
          session.status === "active" && (
            <div className="mt-6 rounded-2xl border border-blue-500/30 bg-blue-500/10 p-5 text-center text-blue-200">
              已送出答案 {selectedAnswer}
            </div>
          )}

        {locked && (
          <div className="mt-6 rounded-2xl border border-zinc-700 bg-zinc-900 p-5 text-center">
            時間到，等待教官公布答案
          </div>
        )}

        {revealed && (
          <div
            className={`mt-6 rounded-3xl border p-7 text-center ${
              isCorrect
                ? "border-green-500/40 bg-green-500/10"
                : "border-red-500/40 bg-red-500/10"
            }`}
          >

            <p className="text-sm tracking-[0.25em] text-zinc-500">
              RESULT
            </p>

            <h2
              className={`mt-3 text-4xl font-semibold ${
                isCorrect
                  ? "text-green-400"
                  : "text-red-400"
              }`}
            >
              {!selectedAnswer
                ? "未作答"
                : isCorrect
                ? "答對了"
                : "答錯了"}
            </h2>

            {selectedAnswer && (
              <p className="mt-5 text-lg text-zinc-300">
                你的答案：
                <strong className="ml-2">
                  {selectedAnswer}
                </strong>
              </p>
            )}

            <p className="mt-2 text-lg text-zinc-300">
              正確答案：
              <strong className="ml-2 text-green-400">
                {question.correct_answer}
              </strong>
            </p>

            <p className="mt-6 text-sm text-zinc-500">
              等待教官進入下一題
            </p>

          </div>
        )}

      </div>
    </main>
  );
}