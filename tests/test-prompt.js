import { ChatGroq } from "@langchain/groq";
import dotenv from "dotenv";
dotenv.config();

async function testPrompt() {
    const model = new ChatGroq({
        model: "moonshotai/kimi-k2-instruct-0905",
        temperature: 0,
        apiKey: process.env.GROQ_API_KEY
    });

    const prompt = `You are an AI assistant processing text extracted from an image. Follow these EXPLICIT RULES based on the type of question found:

RULE 1 (MCQ WITH OPTIONS): If the text contains multiple-choice options (e.g., A, B, C, D), it is an MCQ. Even if it contains code snippets or asks for the output of code, it is STILL an MCQ. Output ONLY the correct option(s) in the format '1. A, 2. B' WITHOUT ANY explanations, theory, or code.

RULE 2 (PURE PROGRAMMING): If there are NO options present and it asks to implement a function, algorithm, or fix a bug, it is a programming task. Provide optimal code in Java or C++.
CRITICAL CODING FORMAT:
- You must ONLY provide the raw inner code that goes strictly inside the function body.
- DO NOT output the \`class Solution { ... }\` wrapper.
- DO NOT output the method signature (e.g., \`int totalNQueens(int n) { ... }\`).
- Output ONLY the internal logic that goes inside the braces.
- Write exceptionally clean, perfectly formatted code. Use standard 4-space indentation for all logical blocks, loops, and conditionals, just like expert human code or ChatGPT output.
- ABSOLUTELY NO MARKDOWN CODE BLOCKS (\` \`\`\` \`). Output raw character code only.

RULE 3 (ERRORS): If the image shows a compilation error or failed test, provide ONLY the corrected code fix strictly following RULE 2 formatting.

If no relevant questions are found, respond exactly with 'No relevant questions found.'`;

    console.log("--- TEST 1: N-Queens Coding Question ---");
    const codeQuestion = "class Solution {\npublic:\n    int totalNQueens(int n) {\n        \n    }\n};";
    let ans = await model.invoke([
        ["system", prompt],
        ["user", "Current question/image text (raw extracted):\n" + codeQuestion]
    ]);
    console.log(ans.content);

    console.log("\n--- TEST 2: MCQ With Code Snippet ---");
    const mcqQuestion = "What is the output of this code?\nint main() { printf(\"Hello\"); return 0; }\nA) Hello\nB) World\nC) Error\nD) None";
    ans = await model.invoke([
        ["system", prompt],
        ["user", "Current question/image text (raw extracted):\n" + mcqQuestion]
    ]);
    console.log(ans.content);
}

testPrompt().catch(console.error);
