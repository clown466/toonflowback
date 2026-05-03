import { EventEmitter } from "events";
import { o_novel } from "@/types/database";
import u from "@/utils";
import { stripThink } from "@/utils/stripThink";
export interface EventType {
  id: number;
  event: string;
}

/*  文本数据清洗
 * @param textData 需要清洗的文本
 * @param windowSize 每组数量 默认5
 * @param overlap 交叠数量 默认1
 * @returns {totalCharacter:所有人物角色卡,totalEvent:所有事件}
 */

class CleanNovel {
  emitter: EventEmitter;
  /** 最大并发数 */
  concurrency: number;

  constructor(concurrency: number = 5) {
    this.emitter = new EventEmitter();
    this.concurrency = concurrency;
  }

  private async processChapter(novel: o_novel): Promise<EventType | null> {
    try {
      const prompt = await u.getPrompts("event");
      const promptData = await u.db("o_prompt").where("type", "eventExtraction").first();
      let eventExtraction = "" as string | undefined;
      if (promptData && promptData.useData) {
        eventExtraction = promptData.useData;
      } else {
        eventExtraction = promptData?.data ?? undefined;
      }
      const chapterText = novel.chapterData ?? "";
      const asciiLetters = chapterText.match(/[A-Za-z]/g)?.length ?? 0;
      const cjkChars = chapterText.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
      const outputLanguage = asciiLetters > cjkChars * 2 ? "English" : "Chinese";
      const languageInstruction =
        outputLanguage === "English"
          ? [
              "SOURCE LANGUAGE: English.",
              "MANDATORY OUTPUT LANGUAGE: English only.",
              "Do not use Chinese characters anywhere in the event row, except if a Chinese character appears verbatim in the source text.",
              "Use English field values: Chapter X {title}, character names as written, Strong/Medium/Weak, High/Medium/Low, N seconds, Conflict/Terror/Twist/etc.",
            ].join("\n")
          : [
              "源文本主语言：中文。",
              "强制输出语言：中文。",
              "请使用中文字段值：第X章、强/中/弱、高/中/低、X秒、冲突/恐怖/转折等。",
            ].join("\n");

      const resData = await u.Ai.Text("universalAi").invoke({
        system: `${eventExtraction || (prompt as string)}\n\n${languageInstruction}`,
        messages: [
          {
            role: "user",
            content:
              `${languageInstruction}\n\n` +
              `Chapter index: ${novel.chapterIndex}\n` +
              `Volume/reel: ${novel.reel ?? ""}\n` +
              `Chapter title: ${novel.chapter ?? ""}\n` +
              `Chapter content:\n${chapterText}`,
          },
        ],
      });
      const preData = stripThink(resData.text);
      this.emitter.emit("item", { id: novel.id, event: preData });
      return { id: novel.id!, event: preData };
    } catch (e) {
      this.emitter.emit("item", { id: novel.id, event: null, errorReason: u.error(e).message });
      return null;
    }
  }

  async start(allChapters: o_novel[], projectId: number): Promise<EventType[]> {
    const totalEvent: EventType[] = [];

    // 并发控制：通过信号量限制同时执行的任务数
    let running = 0;
    let index = 0;
    const results: Promise<void>[] = [];

    const runNext = (): Promise<void> => {
      if (index >= allChapters.length) return Promise.resolve();
      const novel = allChapters[index++];
      running++;

      return this.processChapter(novel).then((result) => {
        if (result) totalEvent.push(result);
        running--;
        return runNext();
      });
    };

    // 启动最多 concurrency 个并发任务
    const workers = Array.from({ length: Math.min(this.concurrency, allChapters.length) }, () => runNext());

    await Promise.all(workers);

    return totalEvent;
  }
}

export default CleanNovel;
