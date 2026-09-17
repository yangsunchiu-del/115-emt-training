"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://wlnzstgskyolvrxjlagb.supabase.co",
  "sb_publishable_RfGKc6tWCWVwhj3nPM_dDw_YhfPEChc"
);

type Question = {
  id: number;
  question_number: number;
  question: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_answer: string;
  duration: number;
};

type SessionState = {
  id: number;
  current_question_id: number | null;
  status: string;
  question_started_at: string | null;
};

type Answer = {
  id: number;
  participant_id: number;
  question_id: number;
  answer: string;
};

type Participant = {
  id: number;
  student_number: string;
  name: string;
  nickname?: string | null;
};

type RankingItem = Participant & {
  score: number;
  answered: number;
};

export default function InstructorPage() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [question, setQuestion] = useState<Question | null>(null);
  const [session, setSession] = useState<SessionState | null>(null);

  const [participants, setParticipants] = useState<Participant[]>([]);
  const [participantCount, setParticipantCount] = useState(0);

  const [answers, setAnswers] = useState<Answer[]>([]);
  const [allAnswers, setAllAnswers] = useState<Answer[]>([]);

  const [secondsLeft, setSecondsLeft] = useState(15);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const [showRanking, setShowRanking] = useState(false);

  async function loadQuestions() {
    const { data, error } = await supabase
      .from("questions")
      .select("*")
      .order("question_number", { ascending: true });

    if (!error && data) {
      setQuestions(data);
    }
  }

  async function loadParticipants() {
    const { data, error } = await supabase
      .from("participants")
      .select("id, student_number, name, nickname")
      .order("student_number", { ascending: true });

    if (!error && data) {
      setParticipants(data);
      setParticipantCount(data.length);
    }
  }

  async function loadAllAnswers() {
    const { data, error } = await supabase
      .from("answers")
      .select("id, participant_id, question_id, answer");

    if (!error && data) {
      setAllAnswers(data);
    }
  }

  async function loadAnswers(questionId?: number | null) {
    const id = questionId ?? session?.current_question_id;

    if (!id) {
      setAnswers([]);
      return;
    }

    const { data, error } = await supabase
      .from("answers")
      .select("id, participant_id, question_id, answer")
      .eq("question_id", id);

    if (!error && data) {
      setAnswers(data);
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
      const { data: q } = await supabase
        .from("questions")
        .select("*")
        .eq("id", data.current_question_id)
        .single();

      if (q) {
        setQuestion(q);
        await loadAnswers(q.id);
      }
    } else {
      setQuestion(null);
      setAnswers([]);
    }
  }

  async function refreshAll() {
    await Promise.all([
      loadQuestions(),
      loadParticipants(),
      loadAllAnswers(),
      loadSession(),
    ]);

    setLoading(false);
  }

  useEffect(() => {
    refreshAll();

    const participantsChannel = supabase
      .channel("instructor-participants-v4")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "participants",
        },
        () => loadParticipants()
      )
      .subscribe();

    const answersChannel = supabase
      .channel("instructor-answers-v4")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "answers",
        },
        () => {
          loadAnswers();
          loadAllAnswers();
        }
      )
      .subscribe();

    const sessionChannel = supabase
      .channel("instructor-session-v4")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "session_state",
        },
        () => loadSession()
      )
      .subscribe();

    const poller = setInterval(() => {
      loadParticipants();
      loadSession();
      loadAllAnswers();
    }, 3000);

    return () => {
      clearInterval(poller);
      supabase.removeChannel(participantsChannel);
      supabase.removeChannel(answersChannel);
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

    const updateTimer = async () => {
      const start = new Date(
        session.question_started_at!
      ).getTime();

      const duration = (question.duration || 15) * 1000;

      const remaining = Math.max(
        0,
        Math.ceil((start + duration - Date.now()) / 1000)
      );

      setSecondsLeft(remaining);

      if (remaining === 0 && session.status === "active") {
        await supabase
          .from("session_state")
          .update({
            status: "locked",
          })
          .eq("id", 1);
      }
    };

    updateTimer();

    const timer = setInterval(updateTimer, 250);

    return () => clearInterval(timer);
  }, [session, question]);

  async function startQuestion(q: Question) {
    setMessage("");
    setShowRanking(false);

    const { error } = await supabase
      .from("session_state")
      .update({
        current_question_id: q.id,
        status: "active",
        question_started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);

    if (error) {
      setMessage("開始題目失敗");
      return;
    }

    setQuestion(q);
    setAnswers([]);
    setSecondsLeft(q.duration || 15);

    await loadSession();
  }

  async function startFirstQuestion() {
    if (questions.length === 0) {
      setMessage("目前沒有題目");
      return;
    }

    await startQuestion(questions[0]);
  }

  async function revealAnswer() {
    const { error } = await supabase
      .from("session_state")
      .update({
        status: "revealed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);

    if (error) {
      setMessage("公布答案失敗");
      return;
    }

    await loadSession();
    await loadAllAnswers();
  }

  async function nextQuestion() {
    if (!question) return;

    const currentIndex = questions.findIndex(
      (q) => q.id === question.id
    );

    if (
      currentIndex === -1 ||
      currentIndex >= questions.length - 1
    ) {
      setMessage("目前已經是最後一題，可以公布 TOP 10！");
      return;
    }

    await startQuestion(questions[currentIndex + 1]);
  }

  async function resetQuiz() {
    if (!window.confirm("確定要把課程重設為等待狀態嗎？")) {
      return;
    }

    const { error } = await supabase
      .from("session_state")
      .update({
        current_question_id: null,
        status: "waiting",
        question_started_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);

    if (error) {
      setMessage("重設失敗");
      return;
    }

    setQuestion(null);
    setAnswers([]);
    setSecondsLeft(15);
    setShowRanking(false);
    setMessage("課程已重設");

    await loadSession();
  }

  async function clearAnswers() {
    if (
      !window.confirm(
        "確定要清空所有學員的答題紀錄嗎？\n\n學員報到資料會保留。"
      )
    ) {
      return;
    }

    const { error } = await supabase
      .from("answers")
      .delete()
      .gte("id", 0);

    if (error) {
      setMessage("清空答題紀錄失敗");
      return;
    }

    await supabase
      .from("session_state")
      .update({
        current_question_id: null,
        status: "waiting",
        question_started_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);

    setAnswers([]);
    setAllAnswers([]);
    setQuestion(null);
    setShowRanking(false);
    setMessage("答題紀錄已清空");

    await refreshAll();
  }

  async function clearStudentsAndAnswers() {
    if (
      !window.confirm(
        "確定要清空整梯資料嗎？\n\n這會刪除所有學員與所有答題紀錄，下一梯將從 0 人重新報到。"
      )
    ) {
      return;
    }

    setMessage("清空中...");

    const { error: answerError } = await supabase
      .from("answers")
      .delete()
      .gte("id", 0);

    if (answerError) {
      setMessage("清空答題紀錄失敗");
      return;
    }

    const { error: participantError } = await supabase
      .from("participants")
      .delete()
      .gte("id", 0);

    if (participantError) {
      setMessage("清空學員失敗");
      return;
    }

    await supabase
      .from("session_state")
      .update({
        current_question_id: null,
        status: "waiting",
        question_started_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);

    setParticipantCount(0);
    setParticipants([]);
    setAnswers([]);
    setAllAnswers([]);
    setQuestion(null);
    setSecondsLeft(15);
    setShowRanking(false);

    setMessage("整梯資料已清空，可以開始下一梯報到");

    await refreshAll();
  }

  function getCount(letter: string) {
    return answers.filter(
      (item) => item.answer === letter
    ).length;
  }

  function getPercent(letter: string) {
    if (answers.length === 0) return 0;

    return Math.round(
      (getCount(letter) / answers.length) * 100
    );
  }

  function getOption(letter: string) {
    if (!question) return "";

    if (letter === "A") return question.option_a;
    if (letter === "B") return question.option_b;
    if (letter === "C") return question.option_c;

    return question.option_d;
  }

  function calculateRanking(): RankingItem[] {
    const ranking = participants.map((participant) => {
      const studentAnswers = allAnswers.filter(
        (a) => a.participant_id === participant.id
      );

      let score = 0;

      studentAnswers.forEach((answer) => {
        const q = questions.find(
          (item) => item.id === answer.question_id
        );

        if (
          q &&
          answer.answer?.toUpperCase() ===
            q.correct_answer?.toUpperCase()
        ) {
          score += 1;
        }
      });

      return {
        ...participant,
        score,
        answered: studentAnswers.length,
      };
    });

    return ranking
      .sort((a, b) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }

        if (b.answered !== a.answered) {
          return b.answered - a.answered;
        }

        return String(a.student_number).localeCompare(
          String(b.student_number)
        );
      })
      .slice(0, 10);
  }

  const ranking = calculateRanking();

  const isLastQuestion =
    question &&
    questions.length > 0 &&
    questions.findIndex((q) => q.id === question.id) ===
      questions.length - 1;

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black text-white">
        <p className="text-xl text-zinc-400">
          教官控制台載入中...
        </p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black px-6 py-8 text-white">
      <div className="mx-auto max-w-6xl">

        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="text-sm tracking-[0.3em] text-zinc-500">
              115年 第四次替代役招訓
            </p>

            <h1 className="mt-3 text-4xl font-semibold">
              EMT 複訓｜教官控制台
            </h1>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 px-6 py-4 text-center">
            <p className="text-xs tracking-[0.2em] text-zinc-500">
              PARTICIPANTS
            </p>

            <p className="mt-1 text-3xl font-semibold text-blue-400">
              {participantCount}
              <span className="text-zinc-600"> / 300</span>
            </p>
          </div>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-4">
          <button
            onClick={clearAnswers}
            className="rounded-2xl border border-zinc-700 bg-zinc-950 px-5 py-4 font-semibold hover:border-blue-500"
          >
            清空答題紀錄
          </button>

          <button
            onClick={clearStudentsAndAnswers}
            className="rounded-2xl border border-red-900 bg-red-950/30 px-5 py-4 font-semibold text-red-300 hover:border-red-500"
          >
            清空學員＋答題紀錄
          </button>

          <button
            onClick={resetQuiz}
            className="rounded-2xl border border-zinc-700 bg-zinc-950 px-5 py-4 font-semibold hover:border-zinc-500"
          >
            重設課程
          </button>

          <button
            onClick={async () => {
              await loadParticipants();
              await loadAllAnswers();
              setShowRanking(!showRanking);
            }}
            className="rounded-2xl border border-yellow-600/60 bg-yellow-500/10 px-5 py-4 font-semibold text-yellow-300 hover:border-yellow-400"
          >
            🏆 {showRanking ? "關閉 TOP 10" : "公布 TOP 10"}
          </button>
        </div>

        {message && (
          <div className="mt-5 rounded-2xl border border-blue-500/30 bg-blue-500/10 p-4 text-center text-blue-200">
            {message}
          </div>
        )}

        {showRanking && (
          <div className="mt-8 rounded-3xl border border-yellow-500/40 bg-zinc-950 p-7 md:p-10">
            <div className="text-center">
              <p className="text-sm tracking-[0.35em] text-yellow-500">
                LEADERBOARD
              </p>

              <h2 className="mt-3 text-4xl font-bold">
                🏆 TOP 10
              </h2>

              <p className="mt-3 text-zinc-500">
                目前累積答題成績
              </p>
            </div>

            <div className="mt-8 space-y-3">
              {ranking.length === 0 ? (
                <div className="rounded-2xl border border-zinc-800 bg-black p-8 text-center text-zinc-500">
                  目前還沒有學員成績
                </div>
              ) : (
                ranking.map((student, index) => (
                  <div
                    key={student.id}
                    className={`flex flex-wrap items-center gap-4 rounded-2xl border p-5 ${
                      index === 0
                        ? "border-yellow-400 bg-yellow-500/10"
                        : index === 1
                        ? "border-zinc-400 bg-zinc-500/10"
                        : index === 2
                        ? "border-orange-700 bg-orange-900/10"
                        : "border-zinc-800 bg-black"
                    }`}
                  >
                    <div className="w-12 text-center text-2xl font-bold">
                      {index === 0
                        ? "🥇"
                        : index === 1
                        ? "🥈"
                        : index === 2
                        ? "🥉"
                        : `${index + 1}`}
                    </div>

                    <div className="min-w-[90px] text-zinc-400">
                      {student.student_number}
                    </div>

                    <div className="min-w-[140px] flex-1">
                      <p className="text-lg font-semibold">
                        {student.name}
                      </p>

                      {student.nickname && (
                        <p className="mt-1 text-sm text-blue-400">
                          😂 {student.nickname}
                        </p>
                      )}
                    </div>

                    <div className="text-right">
                      <p className="text-3xl font-bold text-yellow-400">
                        {student.score}
                        <span className="text-lg text-zinc-600">
                          {" "}
                          / {questions.length}
                        </span>
                      </p>

                      <p className="mt-1 text-xs text-zinc-500">
                        已作答 {student.answered} 題
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {!question ? (
          <div className="mt-8 rounded-3xl border border-zinc-800 bg-zinc-950 p-10 text-center">
            <p className="text-sm tracking-[0.25em] text-zinc-500">
              READY
            </p>

            <h2 className="mt-4 text-3xl font-semibold">
              等待開始
            </h2>

            <p className="mt-3 text-zinc-500">
              題庫共 {questions.length} 題
            </p>

            <button
              onClick={startFirstQuestion}
              className="mt-8 rounded-full bg-blue-500 px-10 py-5 text-xl font-semibold hover:bg-blue-400"
            >
              開始第一題 →
            </button>
          </div>
        ) : (
          <>
            <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_280px]">
              <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-7">
                <div className="flex items-center justify-between">
                  <p className="text-sm tracking-[0.2em] text-zinc-500">
                    QUESTION {question.question_number}
                  </p>

                  <p className="text-sm text-zinc-500">
                    {session?.status === "active"
                      ? "作答中"
                      : session?.status === "locked"
                      ? "時間到"
                      : session?.status === "revealed"
                      ? "答案已公布"
                      : session?.status}
                  </p>
                </div>

                <h2 className="mt-5 text-3xl font-semibold leading-relaxed">
                  {question.question}
                </h2>

                <div className="mt-8 space-y-4">
                  {(["A", "B", "C", "D"] as const).map(
                    (letter) => {
                      const correct =
                        session?.status === "revealed" &&
                        question.correct_answer === letter;

                      return (
                        <div
                          key={letter}
                          className={`rounded-2xl border p-5 ${
                            correct
                              ? "border-green-500 bg-green-500/10"
                              : "border-zinc-800 bg-black"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-5">
                            <div className="text-lg">
                              <span
                                className={`mr-3 font-semibold ${
                                  correct
                                    ? "text-green-400"
                                    : "text-blue-400"
                                }`}
                              >
                                {letter}
                              </span>

                              {getOption(letter)}
                            </div>

                            <div className="min-w-[110px] text-right">
                              <strong className="text-xl">
                                {getCount(letter)}
                              </strong>

                              <span className="ml-2 text-zinc-500">
                                {getPercent(letter)}%
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    }
                  )}
                </div>
              </div>

              <div className="space-y-5">
                <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-7 text-center">
                  <p className="text-xs tracking-[0.25em] text-zinc-500">
                    TIMER
                  </p>

                  <p
                    className={`mt-3 text-6xl font-semibold ${
                      secondsLeft <= 5
                        ? "text-red-400"
                        : "text-white"
                    }`}
                  >
                    {secondsLeft}
                  </p>

                  <p className="mt-2 text-zinc-500">
                    seconds
                  </p>
                </div>

                <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-7 text-center">
                  <p className="text-xs tracking-[0.25em] text-zinc-500">
                    RESPONSES
                  </p>

                  <p className="mt-3 text-4xl font-semibold">
                    {answers.length}

                    <span className="text-zinc-600">
                      {" "}
                      / {participantCount}
                    </span>
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap justify-center gap-4">
              {session?.status === "active" && (
                <button
                  onClick={async () => {
                    await supabase
                      .from("session_state")
                      .update({
                        status: "locked",
                        updated_at: new Date().toISOString(),
                      })
                      .eq("id", 1);

                    await loadSession();
                  }}
                  className="rounded-full border border-zinc-700 px-8 py-4 font-semibold hover:border-zinc-500"
                >
                  提前停止作答
                </button>
              )}

              {session?.status === "locked" && (
                <button
                  onClick={revealAnswer}
                  className="rounded-full bg-green-500 px-10 py-4 text-lg font-semibold text-black hover:bg-green-400"
                >
                  SHOW RESULTS｜公布答案
                </button>
              )}

              {session?.status === "revealed" &&
                !isLastQuestion && (
                  <button
                    onClick={nextQuestion}
                    className="rounded-full bg-blue-500 px-10 py-4 text-lg font-semibold hover:bg-blue-400"
                  >
                    下一題 →
                  </button>
                )}

              {session?.status === "revealed" &&
                isLastQuestion && (
                  <button
                    onClick={async () => {
                      await loadParticipants();
                      await loadAllAnswers();
                      setShowRanking(true);

                      window.scrollTo({
                        top: 0,
                        behavior: "smooth",
                      });
                    }}
                    className="rounded-full bg-yellow-400 px-10 py-4 text-lg font-bold text-black hover:bg-yellow-300"
                  >
                    🏆 公布最終 TOP 10
                  </button>
                )}
            </div>
          </>
        )}

        <div className="mt-10 rounded-3xl border border-zinc-800 bg-zinc-950 p-7">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm tracking-[0.2em] text-zinc-500">
                QUESTION BANK
              </p>

              <h2 className="mt-2 text-2xl font-semibold">
                題庫
              </h2>
            </div>

            <p className="text-zinc-500">
              共 {questions.length} 題
            </p>
          </div>

          <div className="mt-6 space-y-3">
            {questions.map((q) => (
              <button
                key={q.id}
                onClick={() => startQuestion(q)}
                className={`w-full rounded-2xl border p-4 text-left transition ${
                  question?.id === q.id
                    ? "border-blue-500 bg-blue-500/10"
                    : "border-zinc-800 bg-black hover:border-zinc-600"
                }`}
              >
                <span className="mr-4 font-semibold text-blue-400">
                  Q{q.question_number}
                </span>

                {q.question}
              </button>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}