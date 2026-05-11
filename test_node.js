async function testLocalModel() {
    const url = "http://10.16.7.142:11434/v1/chat/completions";
    
    // 模拟 LangGraph 传递给该节点的真实上下文
    const prompt = `
    【输入数据】
    表名：ods_user_log
    字段：user_id (String), action_time (String), page_id (String)
    【处理需求】
    请编写一段 PySpark 代码，过滤出 action_time 在今天的数据，并按 page_id 分组统计 pv。
    `;

    const requestBody = {
        model: "qwen3.5-9b", // 必须和你刚才 create 的名字完全一致
        messages: [
            { role: "user", content: prompt }
        ],
        temperature: 0 // 再次强调温度为 0，确保输出稳定
    };

    console.log("🚀 正在向本地映射的 11434 端口发送请求，请稍候...\n");

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();
        const rawContent = data.choices[0].message.content;

        console.log("--- 1. 模型原始返回 (包含思考过程) ---");
        console.log(rawContent + "\n");

        // 核心步骤：用正则表达式剔除 <think>...</think> 及其内部的所有内容
        const cleanJsonString = rawContent.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

        console.log("--- 2. 清洗后的 JSON 字符串 ---");
        console.log(cleanJsonString + "\n");

        console.log("--- 3. 最终解析为 JavaScript 对象 ---");
        const parsedResult = JSON.parse(cleanJsonString);
        console.log(parsedResult);

        if (parsedResult.status === "success") {
            console.log("\n✅ 验证成功！下游节点可以顺利接收到 data 中的代码。");
        } else {
            console.log("\n⚠️ 节点抛出异常：", parsedResult.data);
        }

    } catch (error) {
        console.error("❌ 请求或解析失败：", error);
    }
}

testLocalModel();