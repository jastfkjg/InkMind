from typing import Literal

from app.language import Language


PROMPTS: dict[str, dict[str, str]] = {
    "naming_category_character": {
        "zh": "人物或角色",
        "en": "Character or Role",
    },
    "naming_category_item": {
        "zh": "物品、器物或道具",
        "en": "Item, Object or Artifact",
    },
    "naming_category_skill": {
        "zh": "功法、武学、招式或技艺名称",
        "en": "Cultivation Technique, Martial Art, Skill or Art",
    },
    "naming_category_other": {
        "zh": "其他命名需求",
        "en": "Other Naming Needs",
    },
    "common_unspecified": {
        "zh": "未指定",
        "en": "Unspecified",
    },
    "common_untitled": {
        "zh": "未命名",
        "en": "Untitled",
    },
    "common_not_filled": {
        "zh": "（未填写）",
        "en": "(Not specified)",
    },
    "common_none": {
        "zh": "（无）",
        "en": "(None)",
    },
    "common_chapter": {
        "zh": "第{i}章",
        "en": "Chapter {i}",
    },
    "common_no_summary": {
        "zh": "（该章暂无概要）",
        "en": "(No summary for this chapter)",
    },
    "naming_system": {
        "zh": "你是网络小说与世界观策划编辑，擅长为角色、物品、功法设计贴切且有辨识度的中文名称。\n【重要】你必须只输出名称列表，每行一个名称，不要输出任何思考过程、前言、解释或说明。\n不要使用编号、不要使用书名号、不要添加任何说明文字。",
        "en": "You are a web novel and worldbuilding editor, skilled at designing appropriate and distinctive names for characters, items, and techniques.\n[IMPORTANT] You must only output a list of names, one per line. Do NOT include any thinking process, preface, explanation, or notes.\nDo not use numbering, book quotes, or any explanatory text. [CRITICAL] Output ALL names in ENGLISH ONLY.",
    },
    "naming_user_intro": {
        "zh": "【作品】{title}\n【类型】{genre}\n【背景（节选）】\n{background}\n\n",
        "en": "[Novel] {title}\n[Genre] {genre}\n[Background (excerpt)]\n{background}\n\n",
    },
    "naming_user_category": {
        "zh": "【类别】{category}\n【命名对象】\n{description}\n\n",
        "en": "[Category] {category}\n[Object to Name]\n{description}\n\n",
    },
    "naming_user_hint": {
        "zh": "【补充要求】\n{hint}\n\n",
        "en": "[Additional Requirements]\n{hint}\n\n",
    },
    "naming_user_closing": {
        "zh": "请给出若干备选中文名称（每行一个，5～10 个为宜）。",
        "en": "Please provide several alternative names (one per line, 5-10 names recommended).",
    },
    "chat_system": {
        "zh": "你是专业的中文小说写作助手。用户正在创作一部小说，请根据作品设定回答写作相关问题，给出可执行的建议；不要编造用户未提供的剧情细节。\n【作品标题】{title}\n【类型】{genre}\n【背景】{background}\n【文风】{writing_style}",
        "en": "You are a professional novel writing assistant. The user is writing a novel. Please answer writing-related questions based on the novel settings and provide actionable advice; do NOT invent plot details not provided by the user.\n[Novel Title] {title}\n[Genre] {genre}\n[Background] {background}\n[Writing Style] {writing_style}. [CRITICAL] Respond in ENGLISH ONLY.",
    },
    "chat_role_user": {
        "zh": "用户",
        "en": "User",
    },
    "chat_role_assistant": {
        "zh": "助手",
        "en": "Assistant",
    },
    "summary_inspire_no_previous": {
        "zh": "（尚无已写章节——本章可作为开篇章。）",
        "en": "(No existing chapters - this chapter can be the opening.)",
    },
    "summary_inspire_chapter_line": {
        "zh": "{i}. 《{title}》\n   概要：{summary}",
        "en": "{i}. \"{title}\"\n   Summary: {summary}",
    },
    "summary_inspire_system_single": {
        "zh": "你是资深中文网络小说策划编辑。你的任务是根据全书设定与已写各章概要，为本章写出一份简短的「本章概要」草案。\n【重要】禁止在输出中包含任何思考过程、推理步骤或 think 标签。\n输出须为 2～4 句自然、连贯的中文，概括本章应写的情节走向或冲突与看点；不要写对白、不展开正文描写；\n不要加标题、编号、引号包裹的说明或任何前后缀。若前情不足，可合理推断承接方向，但不要编造与设定明显矛盾的内容。\n【关键要求】绝对不要重复或改写前文已经写过的情节！你的任务是构思新的、后续的情节，推动故事向前发展。\n前文概要只是帮助你理解前情，不是让你复述或改写。",
        "en": "You are an experienced web novel editor. Your task is to write a brief \"chapter summary\" draft for this chapter based on the overall novel settings and summaries of previous chapters.\n[IMPORTANT] Do NOT include any thinking process, reasoning steps, or think tags in your output.\nOutput must be 2-4 natural, coherent sentences summarizing the plot direction, conflicts, or highlights for this chapter; do not write dialogue, do not expand into full narrative.\nDo not add titles, numbering, quoted explanations, or any prefix/suffix. If previous context is insufficient, you may reasonably infer the continuation direction, but do not invent content that contradicts established settings.\n[KEY REQUIREMENT] NEVER repeat or rewrite plots that have already been written in previous chapters! Your task is to conceive NEW, subsequent plots to advance the story.\nPrevious chapter summaries are only to help you understand the context, not for you to复述 or rewrite.",
    },
    "summary_inspire_closing_single": {
        "zh": "请只输出本章概要草案（2～4 句），直接可用于后续扩写正文。记住：写新情节，不要重复前文。",
        "en": "Please output only the chapter summary draft (2-4 sentences), which can be directly used for expanding into full text later. Remember: write NEW plots, do NOT repeat previous content.",
    },
    "summary_inspire_system_multi": {
        "zh": "你是资深中文网络小说策划编辑。你的任务是根据全书设定与已写各章概要，为接下来连续数章写一份总概要草案。\n【重要】禁止在输出中包含任何思考过程、推理步骤或 think 标签。\n当章节数较多时，概要应更偏整体剧情推进、阶段目标、主要冲突与情绪走向，而不是拘泥于单场景细节。\n输出须为 4～8 句自然、连贯的中文；不要写对白，不要拆成分点或小标题，不要加任何前后缀。\n【关键要求】绝对不要重复或改写前文已经写过的情节！你的任务是构思新的、后续的情节，推动故事向前发展。\n前文概要只是帮助你理解前情，不是让你复述或改写。",
        "en": "You are an experienced web novel editor. Your task is to write an overall summary draft for the next several consecutive chapters based on the novel settings and summaries of existing chapters.\n[IMPORTANT] Do NOT include any thinking process, reasoning steps, or think tags in your output.\nWhen the number of chapters is large, the summary should focus more on overall plot progression, stage goals, main conflicts, and emotional direction, rather than getting caught up in single-scene details.\nOutput must be 4-8 natural, coherent ENGLISH sentences; do not write dialogue, do not break into bullet points or subtitles, do not add any prefix/suffix.\n[KEY REQUIREMENT] NEVER repeat or rewrite plots that have already been written in previous chapters! Your task is to conceive NEW, subsequent plots to advance the story.\nPrevious chapter summaries are only to help you understand the context, not for you to recap or rewrite. [CRITICAL] Output ALL content in ENGLISH ONLY.",
    },
    "summary_inspire_closing_multi": {
        "zh": "请只输出接下来 {chapter_count} 章的总概要草案，重点说明这几章的大致推进、冲突升级与阶段性结果，直接可用于后续拆分成逐章生成任务。记住：写新情节，不要重复前文。",
        "en": "Please output only the overall summary draft for the next {chapter_count} chapters, focusing on the general progression, conflict escalation, and stage results of these chapters. This can be directly used for splitting into chapter-by-chapter generation tasks later. Remember: write NEW plots, do NOT repeat previous content.",
    },
    "summary_inspire_user_intro": {
        "zh": "【作品标题】{title}\n【类型】{genre}\n【背景 / 世界观】\n{background}\n\n【文风】\n{writing_style}\n\n",
        "en": "[Novel Title] {title}\n[Genre] {genre}\n[Background / Worldbuilding]\n{background}\n\n[Writing Style]\n{writing_style}\n\n",
    },
    "summary_inspire_user_previous": {
        "zh": "【本章之前各章概要（按顺序）】\n{previous_summaries}\n\n",
        "en": "[Summaries of chapters before this one (in order)]\n{previous_summaries}\n\n",
    },
    "summary_inspire_user_chapter_count": {
        "zh": "【计划生成章节数】{chapter_count}\n\n",
        "en": "[Planned chapters to generate] {chapter_count}\n\n",
    },
    "selection_expand_system": {
        "zh": "你是小说作者。用户选中了文中一段文字，请对其进行扩写。保持与全书类型、文风一致、情节连贯；增加细节、描写或节奏，使片段更丰满。只输出扩写后的正文片段，不要解释、不要前后缀、不要引用说明。",
        "en": "You are a novel author. The user has selected a passage and wants you to expand it. Maintain consistency with the novel's genre, writing style, and plot continuity; add details, descriptions, or pacing to make the fragment richer. Output only the expanded text fragment, no explanations, no prefix/suffix, no quoted references. [CRITICAL] Output in ENGLISH ONLY.",
    },
    "selection_polish_system": {
        "zh": "你是小说编辑。用户选中了文中一段文字，请对其进行润色。保持原意与叙事节奏，优化句式、用词与节奏；避免口水套话与模板化表达。只输出润色后的正文片段，不要解释、不要前后缀。",
        "en": "You are a novel editor. The user has selected a passage and wants you to polish it. Maintain the original meaning and narrative rhythm; optimize sentence structure, word choice, and pacing; avoid clichés and template expressions. Output only the polished text fragment, no explanations, no prefix/suffix. [CRITICAL] Output in ENGLISH ONLY.",
    },
    "selection_overview": {
        "zh": "【作品】{title}\n【类型】{genre}\n【文风】{writing_style}\n【章节标题】{chapter_title}\n【本章概要】\n{chapter_summary}\n",
        "en": "[Novel] {title}\n[Genre] {genre}\n[Writing Style] {writing_style}\n[Chapter Title] {chapter_title}\n[Chapter Summary]\n{chapter_summary}\n",
    },
    "selection_full_context": {
        "zh": "【全文节选供上下文参考】\n{context}\n\n",
        "en": "[Full text excerpt for context reference]\n{context}\n\n",
    },
    "selection_selected": {
        "zh": "【选中片段】\n{selected}\n\n",
        "en": "[Selected passage]\n{selected}\n\n",
    },
    "selection_expand_closing": {
        "zh": "请只输出扩写后的正文片段，不要包含标题或说明。",
        "en": "Please output only the expanded text fragment, do not include titles or explanations.",
    },
    "selection_polish_closing": {
        "zh": "请只输出润色后的正文片段。",
        "en": "Please output only the polished text fragment.",
    },
    "summarize_body_system": {
        "zh": "你是文学编辑。请用尽量简短的 1～4 句简体中文概括本章正文要点，不要加标题、编号或引号，不要评价文笔。",
        "en": "You are a literary editor. Please summarize the main points of this chapter text in 1-4 concise sentences. Do not add titles, numbering, or quotes. Do not evaluate the writing style. [CRITICAL] Summarize in ENGLISH ONLY.",
    },
    "summarize_body_user": {
        "zh": "章节标题：{title}\n\n正文：\n{content}",
        "en": "Chapter Title: {title}\n\nContent:\n{content}",
    },
    "revise_system": {
        "zh": "你是小说作者与编辑。根据用户的修改要求，改写本章正文。保持与作品类型、文风及前文语境一致；只输出改写后的完整正文，不要前言或解释。",
        "en": "You are a novel author and editor. Rewrite this chapter's text based on the user's modification requirements. Maintain consistency with the novel's genre, writing style, and previous context; output only the complete rewritten text, no preface or explanations. [CRITICAL] Output in ENGLISH ONLY.",
    },
    "revise_user_intro": {
        "zh": "【类型】{genre}\n【文风】{writing_style}\n【章节标题】{chapter_title}\n\n",
        "en": "[Genre] {genre}\n[Writing Style] {writing_style}\n[Chapter Title] {chapter_title}\n\n",
    },
    "revise_user_current": {
        "zh": "【当前正文】\n{content}\n\n",
        "en": "[Current Text]\n{content}\n\n",
    },
    "revise_user_instruction": {
        "zh": "【修改要求】\n{instruction}\n\n",
        "en": "[Modification Requirements]\n{instruction}\n\n",
    },
    "revise_user_closing": {
        "zh": "请输出修改后的完整正文。",
        "en": "Please output the complete modified text.",
    },
    "revise_empty_note": {
        "zh": "（空）",
        "en": "(Empty)",
    },
    "append_system": {
        "zh": "你是小说作者。根据用户要求，在现有正文之后撰写新增内容。保持与作品类型、文风一致；不要复述或重复已有段落。只输出要追加的新正文，不要包含「已有正文」中的句子。",
        "en": "You are a novel author. Based on the user's requirements, write additional content after the existing text. Maintain consistency with the novel's genre and writing style; do not recap or repeat existing paragraphs. Output only the new text to append, do not include sentences from the \"existing text\". [CRITICAL] Output in ENGLISH ONLY.",
    },
    "append_user_intro": {
        "zh": "【类型】{genre}\n【文风】{writing_style}\n【章节标题】{chapter_title}\n\n",
        "en": "[Genre] {genre}\n[Writing Style] {writing_style}\n[Chapter Title] {chapter_title}\n\n",
    },
    "append_user_existing": {
        "zh": "【已有正文】\n{content}\n\n",
        "en": "[Existing Text]\n{content}\n\n",
    },
    "append_user_empty": {
        "zh": "（尚无正文，请直接按下列要求撰写开篇段落）",
        "en": "(No text yet, please write the opening paragraph directly according to the requirements below)",
    },
    "append_user_instruction": {
        "zh": "【追加要求】\n{instruction}\n\n",
        "en": "[Append Requirements]\n{instruction}\n\n",
    },
    "append_user_closing": {
        "zh": "请只输出要接在文末的新增正文。",
        "en": "Please output only the new text to append at the end.",
    },
    "title_suggest_system": {
        "zh": "你是文学编辑。请根据作品信息与本章内容，给出唯一一个合适的章节标题。标题不得与本书已有章节标题重复。只输出标题本身：不超过18个汉字，不要书名号、引号、编号或任何解释。",
        "en": "You are a literary editor. Please provide ONE appropriate chapter title based on the novel information and chapter content. The title must NOT duplicate existing chapter titles in this novel. Output only the title itself: max 60 characters in ENGLISH, no book quotes, quotation marks, numbering, or any explanations. [CRITICAL] Output the title in ENGLISH ONLY.",
    },
    "title_suggest_user_intro": {
        "zh": "【作品】{title}\n【类型】{genre}\n",
        "en": "[Novel] {title}\n[Genre] {genre}\n",
    },
    "title_suggest_user_existing": {
        "zh": "【已有章节标题（禁止重名）】\n{existing_titles}\n",
        "en": "[Existing Chapter Titles (DO NOT duplicate)]\n{existing_titles}\n",
    },
    "title_suggest_user_summary": {
        "zh": "【本章摘要】{summary}\n",
        "en": "[Chapter Summary] {summary}\n",
    },
    "title_suggest_user_excerpt": {
        "zh": "【本章正文节选】\n{excerpt}\n",
        "en": "[Chapter Text Excerpt]\n{excerpt}\n",
    },
    "title_suggest_user_hint": {
        "zh": "【用户补充说明】{hint}",
        "en": "[User Additional Notes] {hint}",
    },
    "title_suggest_no_content": {
        "zh": "（尚无正文）",
        "en": "(No text yet)",
    },
    "gen_system_fixed_title": {
        "zh": "你是一位专业中文小说作者。请根据作品背景、已有章节语境与本章概要，创作本章正文。要求：1. 使用自然流畅的现代汉语叙事，符合给定文风与类型。2. 你必须只输出一个 JSON 对象（UTF-8），不要 markdown 代码块以外的解释文字。3. JSON 只能有一个键 body，值为字符串：本章完整正文。4. 正文中不要写章节标题、章节号或「本章」等结构标签。5. 【重要】前文情节概要是已完成的内容，绝对不要重复或改写！本章必须续写全新的情节，推动故事向前发展。6. 【重要】不要复述前文情节，直接开始写本章的新内容。{word_count_req}",
        "en": "You are a professional novel author. Please write this chapter's text based on the novel background, context of previous chapters, and chapter summary. Requirements: 1. Use natural and fluent ENGLISH narrative, consistent with the given writing style and genre. 2. You must output only a JSON object (UTF-8), no explanatory text outside markdown code blocks. 3. JSON must have only one key 'body', with string value: the complete chapter text. 4. Do NOT write chapter titles, chapter numbers, or structural labels like \"this chapter\" in the text. 5. [IMPORTANT] Previous chapter summaries are completed content, NEVER repeat or rewrite them! This chapter must continue with NEW plots to advance the story. 6. [IMPORTANT] Do not recap previous plots, start writing new content for this chapter directly. 7. [CRITICAL] Output ALL content in ENGLISH ONLY. {word_count_req}",
    },
    "gen_system_dynamic_title": {
        "zh": "你是一位专业中文小说作者。请根据作品背景、已有章节语境与本章概要，创作本章。要求：1. 使用自然流畅的现代汉语叙事，符合给定文风与类型。2. 你必须只输出一个 JSON 对象（UTF-8），不要 markdown 代码块以外的解释文字。3. JSON 必须包含两个字符串键：title（章节标题，不超过15字，勿加书名号）与 body（本章完整正文）。4. 正文中不要写章节标题行、章节号或「本章」等结构标签。5. 【重要】前文情节概要是已完成的内容，绝对不要重复或改写！本章必须续写全新的情节，推动故事向前发展。6. 【重要】不要复述前文情节，直接开始写本章的新内容。{word_count_req}",
        "en": "You are a professional novel author. Please write this chapter based on the novel background, context of previous chapters, and chapter summary. Requirements: 1. Use natural and fluent ENGLISH narrative, consistent with the given writing style and genre. 2. You must output only a JSON object (UTF-8), no explanatory text outside markdown code blocks. 3. JSON must contain two string keys: 'title' (chapter title in ENGLISH, max 60 characters) and 'body' (complete chapter text in ENGLISH). 4. Do NOT write chapter title lines, chapter numbers, or structural labels like \"this chapter\" in the text. 5. [IMPORTANT] Previous chapter summaries are completed content, NEVER repeat or rewrite them! This chapter must continue with NEW plots to advance the story. 6. [IMPORTANT] Do not recap previous plots, start writing new content for this chapter directly. 7. [CRITICAL] Output ALL content (title and body) in ENGLISH ONLY. {word_count_req}",
    },
    "gen_title_line_fixed": {
        "zh": "\n【本章标题（已定，勿写入正文）】{title}",
        "en": "\n[Chapter Title (fixed, do NOT write in text)] {title}",
    },
    "gen_title_line_existing": {
        "zh": "\n【当前章节已有标题（可改写或沿用模型生成的 title）】{title}",
        "en": "\n[Current chapter already has title (can rewrite or use model's generated 'title')] {title}",
    },
    "gen_user_task": {
        "zh": "【本章任务】\n本章概要：{summary}\n",
        "en": "[Chapter Task]\nChapter Summary: {summary}\n",
    },
    "gen_user_warning": {
        "zh": "\n【特别提醒】\n- 前文情节概要是已完成的内容，不要重复、不要改写、不要复述\n- 本章必须写全新的内容，推动故事向前发展\n- 直接开始写本章正文，不要有任何回顾前文的内容\n\n请严格按 system 要求的 JSON 结构输出。",
        "en": "\n[Special Reminder]\n- Previous chapter summaries are completed content, do NOT repeat, rewrite, or复述 them\n- This chapter must contain NEW content to advance the story\n- Start writing this chapter's text directly, no retrospective content\n\nPlease output strictly according to the JSON structure required by system.",
    },
    "gen_word_count_req": {
        "zh": "\n5. 正文长度尽量控制在 {count} 字左右（允许上下浮动 10%）。",
        "en": "\n5. Keep the text length around {count} characters (allow +/-10%).",
    },
    "batch_plan_system": {
        "zh": "你是资深中文长篇小说策划编辑。请把用户给出的后续总概要拆分成逐章计划。【重要】禁止输出思考过程、推理步骤或 think 标签。你必须只输出合法 JSON 对象，结构为 {\"chapters\": [{\"title\": \"...\", \"summary\": \"...\"}]}。chapters 数组长度必须严格等于用户要求的章节数。每章都要有不重复的标题与摘要；标题不得与已存在章节重名；summary 用 2～4 句概括本章主要推进。当章节数较多时，要注意整体节奏递进，让前几章偏铺垫，中间推动冲突，结尾形成阶段性结果。",
        "en": "You are an experienced long-form novel editor. Please split the user's overall future summary into chapter-by-chapter plans. [IMPORTANT] Do NOT output thinking process, reasoning steps, or think tags. You must output only a valid JSON object with structure: {\"chapters\": [{\"title\": \"...\", \"summary\": \"...\"}]}. The chapters array length must strictly equal the number of chapters requested. Each chapter must have a unique title and summary; titles must NOT duplicate existing chapter titles; summary uses 2-4 sentences to describe the main progression. When the number of chapters is large, pay attention to overall pacing: earlier chapters focus on setup, middle chapters advance conflict, and later chapters form stage results.",
    },
    "batch_plan_user_position": {
        "zh": "【生成位置】\n从《{after_title}》之后开始，连续规划 {chapter_count} 章。\n\n",
        "en": "[Generation Position]\nStarting after \"{after_title}\", plan {chapter_count} consecutive chapters.\n\n",
    },
    "batch_plan_user_summary": {
        "zh": "【后续总概要】\n{total_summary}\n\n",
        "en": "[Overall Future Summary]\n{total_summary}\n\n",
    },
    "batch_plan_user_closing": {
        "zh": "请严格输出 JSON。",
        "en": "Please output strictly as JSON.",
    },
    "batch_plan_no_existing": {
        "zh": "（无）",
        "en": "(None)",
    },
    "batch_plan_current_chapter": {
        "zh": "当前章节",
        "en": "Current chapter",
    },
    "batch_plan_default_summary": {
        "zh": "围绕后续主线推进第{idx}章剧情，并与前文自然衔接。",
        "en": "Advance the main plot for chapter {idx}, naturally connecting with previous content.",
    },
    "batch_plan_default_summary_alt": {
        "zh": "承接后续总概要，推进第{idx}章剧情，并形成明确的场景与冲突。",
        "en": "Following the overall summary, advance chapter {idx}'s plot, forming clear scenes and conflicts.",
    },
    "react_task_intro": {
        "zh": "请根据以下信息创作小说章节正文。\n\n【本章概要】\n{summary}\n\n【核心要求】\n- {title_req}\n- 正文应符合作品设定、文风和类型\n- 情节需与前文衔接自然，人物言行符合其设定\n- 请使用工具获取必要的上下文信息（作品设定、前文情节、人物设定）{word_count_req}\n\n【下一步】\n请调用工具获取上下文信息，然后生成正文。不要直接输出 Final。",
        "en": "Please write the novel chapter text based on the following information.\n\n[Chapter Summary]\n{summary}\n\n[Core Requirements]\n- {title_req}\n- Text must be consistent with novel settings, writing style, and genre\n- Plot must connect naturally with previous chapters, character actions must match their established personalities\n- Please use tools to obtain necessary context information (novel settings, previous plots, character profiles) {word_count_req}\n\n[Next Step]\nPlease call tools to get context information, then generate the text. Do NOT output Final directly.",
    },
    "react_title_req_fixed": {
        "zh": "本章标题已指定为「{title}」，请在生成正文时不要写入标题。",
        "en": "Chapter title is fixed as \"{title}\", do NOT write the title in the generated text.",
    },
    "react_title_req_dynamic": {
        "zh": "标题将在生成后自动提取或由用户指定。",
        "en": "Title will be extracted automatically after generation or specified by the user.",
    },
    "react_word_count_req": {
        "zh": "\n- 正文长度尽量控制在 {count} 字左右（允许上下浮动 10%）。",
        "en": "\n- Keep the text length around {count} characters (allow +/-10%).",
    },
    "flexible_task_intro": {
        "zh": "请为小说创作本章正文。\n\n【本章概要】\n{summary}\n\n【任务目标】\n1. {title_req}\n2. 正文应符合作品设定、文风和类型。\n3. 情节需与前文衔接自然，人物言行符合其设定。\n4. 请根据需要调用工具获取必要的上下文信息（作品设定、前文情节、人物设定）。\n5. 在收集到足够的上下文信息后，调用 generate_chapter 工具生成正文。\n6. 生成正文后，调用 finish 工具完成任务。{word_count_req}\n\n【工作流程建议】\n虽然你可以自由决定行动顺序，但建议遵循以下流程：\n1. 调用 get_novel_context 获取作品基础设定\n2. 调用 get_previous_chapters 获取前文情节\n3. 调用 get_character_profiles 获取相关人物设定\n4. 调用 generate_chapter 生成章节正文\n5. 调用 finish 完成任务\n\n【重要规则】\n1. 只有在调用 generate_chapter 生成正文后，才能调用 finish\n2. 不要在没有生成正文的情况下就调用 finish\n3. 请确保你的输出始终是有效的 JSON 格式",
        "en": "Please write this chapter's text for the novel.\n\n[Chapter Summary]\n{summary}\n\n[Task Goals]\n1. {title_req}\n2. Text must be consistent with novel settings, writing style, and genre.\n3. Plot must connect naturally with previous chapters, character actions must match their established personalities.\n4. Please call tools as needed to obtain necessary context information (novel settings, previous plots, character profiles).\n5. After gathering sufficient context, call generate_chapter tool to generate the text.\n6. After generating the text, call finish tool to complete the task. {word_count_req}\n\n[Suggested Workflow]\nAlthough you may freely decide the order of actions, we recommend following this process:\n1. Call get_novel_context to get basic novel settings\n2. Call get_previous_chapters to get previous chapter plots\n3. Call get_character_profiles to get relevant character profiles\n4. Call generate_chapter to generate chapter text\n5. Call finish to complete the task\n\n[Important Rules]\n1. You can only call finish AFTER calling generate_chapter to generate text\n2. Do NOT call finish without generating text first\n3. Please ensure your output is always valid JSON format",
    },
    "flexible_title_req_fixed": {
        "zh": "本章标题已指定为「{title}」，请在生成正文时不要写入标题。",
        "en": "Chapter title is fixed as \"{title}\", do NOT write the title in the generated text.",
    },
    "flexible_title_req_dynamic": {
        "zh": "标题将在生成后自动提取或由用户指定。",
        "en": "Title will be extracted automatically after generation or specified by the user.",
    },
    "flexible_word_count_req": {
        "zh": "\n- 正文长度尽量控制在 {count} 字左右（允许上下浮动 10%）。",
        "en": "\n- Keep the text length around {count} characters (allow +/-10%).",
    },
    "common_new_chapter": {
        "zh": "新章",
        "en": "New Chapter",
    },
    "stream_direct_mode": {
        "zh": "[直接模式] 正在生成章节...\n",
        "en": "[Direct Mode] Generating chapter...\n",
    },
    "stream_react_mode": {
        "zh": "[ReAct模式] 正在生成章节...\n",
        "en": "[ReAct Mode] Generating chapter...\n",
    },
    "stream_flexible_mode": {
        "zh": "[Flexible模式] 正在生成章节...\n",
        "en": "[Flexible Mode] Generating chapter...\n",
    },
    "stream_auto_audit": {
        "zh": "\n[自动审核] 正在评估内容质量...\n",
        "en": "\n[Auto Audit] Evaluating content quality...\n",
    },
    "stream_score_warning": {
        "zh": "\n[提示] 内容评分（{score}分）低于阈值（{threshold}分），建议修改后保存。\n",
        "en": "\n[Hint] Content score ({score} points) is below threshold ({threshold} points), recommended to revise before saving.\n",
    },
    "stream_audit_failed": {
        "zh": "\n[警告] 自动审核失败: {error}\n",
        "en": "\n[Warning] Auto audit failed: {error}\n",
    },
    "stream_planning_chapters": {
        "zh": "正在规划接下来 {count} 章...\n",
        "en": "Planning next {count} chapters...\n",
    },
    "stream_generating_chapter": {
        "zh": "[{current}/{total}] 正在生成《{title}》...\n",
        "en": "[{current}/{total}] Generating \"{title}\"...\n",
    },
    "stream_chapter_done": {
        "zh": "[{current}/{total}] 已完成《{title}》\n",
        "en": "[{current}/{total}] Completed \"{title}\"\n",
    },
    "evaluate_system": {
        "zh": "你是严谨的文学编辑与中文网文审稿人。\n【重要】禁止在输出中包含任何思考过程、推理步骤或 think 标签。\n用户会提供一部小说的某一章：标题、本章概要（若有）与正文。\n请只指出写得不够好或容易显得「像 AI 生成」的地方，每条说明为何不理想。\n不要泛泛夸奖，不要编造正文中不存在的情节；若没有值得指出的问题，issues 可为空列表。\n同时给出一个 0～100 的整数 de_ai_score，表示「去 AI 化」程度：\n分数越高，表示读起来越像自然的人类创作，越少模板句、堆砌副词、空洞比喻、机械转折与万能套话。\n若正文极短或几乎为空，可将 de_ai_score 设为 0，issues 说明原因。\n【重要】你必须只输出合法 JSON 对象，不要 markdown 代码围栏以外的任何文字，不要包含思考过程。\n键名固定为 issues 与 de_ai_score。\nissues 为数组，元素为对象，字段 aspect（问题点简述）与 detail（理由），均为字符串。",
        "en": "You are a rigorous literary editor and web novel reviewer.\n[IMPORTANT] Do NOT include any thinking process, reasoning steps, or think tags in your output.\nThe user will provide a chapter of a novel: title, chapter summary (if any), and the text.\nPlease only point out parts that are not well-written or seem \"AI-generated\", explaining why each is不理想.\nDo not give general praise, do not invent plots that do not exist in the text; if there are no issues worth pointing out, issues can be an empty list.\nAlso provide an integer de_ai_score from 0 to 100, representing the \"de-AI-fication\" degree:\nThe higher the score, the more it reads like natural human writing, with fewer template sentences, stacked adverbs, empty metaphors, mechanical transitions, and generic clichés.\nIf the text is extremely short or nearly empty, you can set de_ai_score to 0, with issues explaining the reason.\n[IMPORTANT] You must output only a valid JSON object, no text outside markdown code fences, no thinking process.\nThe keys must be fixed as issues and de_ai_score.\nissues is an array of objects, with fields aspect (brief description of the issue) and detail (reason), both strings.",
    },
    "evaluate_user_intro": {
        "zh": "【作品类型】{genre}\n【书名】{title}\n\n",
        "en": "[Genre] {genre}\n[Title] {title}\n\n",
    },
    "evaluate_user_chapter": {
        "zh": "【本章标题】{chapter_title}\n【本章概要】\n{chapter_summary}\n\n",
        "en": "[Chapter Title] {chapter_title}\n[Chapter Summary]\n{chapter_summary}\n\n",
    },
    "evaluate_user_content": {
        "zh": "【正文】\n{content}",
        "en": "[Content]\n{content}",
    },
}


def get_prompt(key: str, language: Language, **kwargs) -> str:
    """
    Get a translated prompt for the given language.
    
    Args:
        key: The prompt key
        language: The target language ("zh" or "en")
        **kwargs: Optional format arguments for the prompt
        
    Returns:
        The translated prompt string
    """
    if key not in PROMPTS:
        return key
    
    lang_prompts = PROMPTS[key]
    text = lang_prompts.get(language, lang_prompts.get("zh", key))
    
    if kwargs:
        try:
            return text.format(**kwargs)
        except (KeyError, IndexError):
            return text
    
    return text
