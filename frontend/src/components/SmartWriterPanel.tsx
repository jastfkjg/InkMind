import { useCallback, useEffect, useState, useRef } from "react";
import { useI18n } from "@/i18n";
import {
  type WorkflowProgress,
  type PhaseDisplayResult,
  type WorkflowStatus,
  type CreateWorkflowRequest,
  type WorkflowPhaseType,
  PHASE_NAMES,
} from "@/types/workflow";
import {
  createWorkflow,
  executePhase,
  executePhaseStream,
  confirmPhase,
  saveWorkflowChapter,
  fetchWorkflowProgress,
} from "@/api/client";
import { Modal } from "antd";
import type { Chapter } from "@/types";

function formatMessage(template: string, params: Record<string, unknown>): string {
  let result = template;
  for (const [key, value] of Object.entries(params)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, "g"), String(value));
  }
  return result;
}

export interface SmartWriterPanelProps {
  novelId: number;
  activeChapterId?: number | null;
  onChapterSaved?: (chapter: Partial<Chapter> & { id: number; title: string }) => void;
}

type MessageRole = "user" | "assistant" | "system" | "error";

interface Message {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  isStreaming?: boolean;
  isEditable?: boolean;
  editableContent?: Record<string, string>;
  actionButtons?: ActionButton[];
}

interface ActionButton {
  label: string;
  type: "primary" | "default" | "danger";
  action: () => void;
}

interface WriterState {
  workflowId: string | null;
  progress: WorkflowProgress | null;
  targetChapterCount: number;
  completedChapterCount: number;
  currentChapter: {
    index: number;
    title: string;
    summary: string;
    content: string;
  } | null;
  isWaiting: boolean;
}

const SESSION_KEY = "inkmind_smart_writer_session";

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

function getStoredSession(novelId: number): { workflowId: string | null } | null {
  try {
    const key = `${SESSION_KEY}_${novelId}`;
    const stored = localStorage.getItem(key);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    /* ignore */
  }
  return null;
}

function setStoredSession(novelId: number, workflowId: string | null): void {
  try {
    const key = `${SESSION_KEY}_${novelId}`;
    if (workflowId) {
      localStorage.setItem(key, JSON.stringify({ workflowId }));
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    /* ignore */
  }
}

function parseInstruction(message: string): { type: string; params: Record<string, unknown> } {
  const lowerMsg = message.toLowerCase();
  
  const chapterMatch = lowerMsg.match(/(\d+)\s*(章|chapter)/);
  const chapterCount = chapterMatch ? parseInt(chapterMatch[1]) : 1;
  
  if (lowerMsg.includes("写") || lowerMsg.includes("继续") || lowerMsg.includes("生成") || 
      lowerMsg.includes("write") || lowerMsg.includes("continue") || lowerMsg.includes("generate")) {
    if (chapterCount > 1) {
      return { type: "generate_multiple", params: { count: chapterCount } };
    }
    return { type: "generate_one", params: {} };
  }
  
  if (lowerMsg.includes("修改") || lowerMsg.includes("改") || lowerMsg.includes("modify") || lowerMsg.includes("change")) {
    return { type: "modify", params: { instruction: message } };
  }
  
  if (lowerMsg.includes("确认") || lowerMsg.includes("继续写") || lowerMsg.includes("下一章") ||
      lowerMsg.includes("confirm") || lowerMsg.includes("next")) {
    return { type: "confirm", params: {} };
  }
  
  if (lowerMsg.includes("取消") || lowerMsg.includes("停止") || lowerMsg.includes("cancel") || lowerMsg.includes("stop")) {
    return { type: "cancel", params: {} };
  }
  
  if (lowerMsg.includes("保存") || lowerMsg.includes("save")) {
    return { type: "save", params: {} };
  }
  
  return { type: "question", params: { question: message } };
}

export default function SmartWriterPanel({
  novelId,
  activeChapterId: _activeChapterId,
  onChapterSaved,
}: SmartWriterPanelProps) {
  const { t } = useI18n();
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  
  const [writerState, setWriterState] = useState<WriterState>({
    workflowId: null,
    progress: null,
    targetChapterCount: 0,
    completedChapterCount: 0,
    currentChapter: null,
    isWaiting: false,
  });
  
  const [editMode, setEditMode] = useState(false);
  const [editFields, setEditFields] = useState<Record<string, string>>({});
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const initializedRef = useRef(false);
  
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);
  
  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);
  
  const addMessage = useCallback((role: MessageRole, content: string, options?: Partial<Message>): string => {
    const id = generateId();
    const msg: Message = {
      id,
      role,
      content,
      timestamp: Date.now(),
      ...options,
    };
    setMessages((prev) => [...prev, msg]);
    return id;
  }, []);
  
  const updateMessage = useCallback((id: string, updates: Partial<Message>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...updates } : m)));
  }, []);
  
  const addSystemMessage = useCallback((content: string) => {
    return addMessage("system", content);
  }, [addMessage]);
  
  const addAssistantMessage = useCallback((content: string, options?: Partial<Message>) => {
    return addMessage("assistant", content, options);
  }, [addMessage]);
  
  const addErrorMessage = useCallback((content: string) => {
    return addMessage("error", content);
  }, [addMessage]);
  
  const formatProgressMessage = useCallback((progress: WorkflowProgress): string => {
    const phaseName = t(PHASE_NAMES[progress.current_phase].key);
    const statusMap: Record<WorkflowStatus, string> = {
      pending: t("workflow_status_pending"),
      running: t("workflow_status_running"),
      waiting_user_confirm: t("workflow_status_waiting"),
      completed: t("workflow_status_completed"),
      failed: t("workflow_status_failed"),
      cancelled: t("workflow_status_cancelled"),
    };
    return `${phaseName} - ${statusMap[progress.status]}`;
  }, [t]);
  
  const formatPhaseResult = useCallback((result: PhaseDisplayResult, phase: WorkflowPhaseType): string => {
    if (!result.success) {
      return `${t("workflow_status_failed")}: ${result.error_message || t("common_unknown_error")}`;
    }
    
    const phaseName = t(PHASE_NAMES[phase].key);
    let content = `**${phaseName}** ${t("workflow_result_complete")}\n\n`;
    
    if (phase === "chapter_summary") {
      const summary = result.display_content.chapter_summary as string;
      const title = result.display_content.title as string;
      if (title) {
        content += `**${t("workflow_field_title")}**: ${title}\n\n`;
      }
      if (summary) {
        content += `**${t("workflow_field_summary")}**: ${summary}\n\n`;
      }
    } else if (phase === "chapter_content") {
      const title = result.display_content.title as string;
      const body = result.display_content.body as string;
      if (title) {
        content += `**${t("workflow_field_title")}**: ${title}\n\n`;
      }
      if (body) {
        const preview = body.length > 200 ? body.substring(0, 200) + "..." : body;
        content += `**${t("workflow_field_body")}**: ${preview}\n\n`;
      }
    }
    
    if (result.suggestions && result.suggestions.length > 0) {
      content += `**${t("workflow_suggestions")}**:\n`;
      result.suggestions.forEach((s, i) => {
        content += `${i + 1}. ${s}\n`;
      });
    }
    
    if (result.next_step_suggestion) {
      content += `\n💡 ${result.next_step_suggestion}`;
    }
    
    return content;
  }, [t]);
  
  const createWriterWorkflow = useCallback(async (chapterCount: number = 1) => {
    setIsBusy(true);
    
    addAssistantMessage(
      chapterCount > 1 
        ? formatMessage(t("smart_writer_starting_multiple"), { count: chapterCount })
        : t("smart_writer_starting_single")
    );
    
    try {
      const payload: CreateWorkflowRequest = {
        initial_phase: "chapter_summary",
        target_chapter_count: chapterCount,
      };
      
      const result = await createWorkflow(novelId, payload);
      
      setWriterState((prev) => ({
        ...prev,
        workflowId: result.workflow_id,
        progress: result.progress,
        targetChapterCount: chapterCount,
        completedChapterCount: 0,
        currentChapter: null,
        isWaiting: false,
      }));
      
      setStoredSession(novelId, result.workflow_id);
      
      addAssistantMessage(formatProgressMessage(result.progress));
      
      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      addErrorMessage(`${t("workflow_create_failed")}: ${err.message}`);
      return null;
    } finally {
      setIsBusy(false);
    }
  }, [novelId, addAssistantMessage, addErrorMessage, formatProgressMessage, t]);
  
  const executeCurrentPhase = useCallback(async (workflowId: string, modifications?: Record<string, unknown>) => {
    setIsBusy(true);
    
    const assistantMsgId = addAssistantMessage("", { isStreaming: true });
    
    try {
      const initialProgress = await fetchWorkflowProgress(novelId, workflowId);
      const currentPhase = initialProgress.current_phase;
      
      if (currentPhase === "chapter_summary") {
        setIsStreaming(false);
        
        const result = await executePhase(novelId, workflowId, {
          user_modifications: modifications,
        });
        
        if (!result.success) {
          updateMessage(assistantMsgId, {
            content: `${t("workflow_execute_failed")}: ${result.error_message || t("common_unknown_error")}`,
            isStreaming: false,
            role: "error",
          });
          return null;
        }
        
        const progress = result.progress;
        
        setWriterState((prev) => ({
          ...prev,
          progress,
          isWaiting: progress.status === "waiting_user_confirm",
        }));
        
        if (progress.current_result) {
          const resultMsg = formatPhaseResult(progress.current_result, progress.current_phase);
          updateMessage(assistantMsgId, { 
            content: resultMsg, 
            isStreaming: false,
            isEditable: progress.current_result.editable_fields.length > 0,
            editableContent: Object.fromEntries(
              progress.current_result.editable_fields.map((f) => [
                f,
                String(progress.current_result?.display_content[f] || ""),
              ])
            ),
          });
        }
        
        return progress;
      } else {
        setIsStreaming(true);
        
        let accumulatedText = "";
        
        await executePhaseStream(
          novelId,
          workflowId,
          modifications,
          {
            onToken: (chunk: string) => {
              accumulatedText += chunk;
            }
          }
        );
        
        const progress = await fetchWorkflowProgress(novelId, workflowId);
        
        setWriterState((prev) => ({
          ...prev,
          progress,
          isWaiting: progress.status === "waiting_user_confirm",
        }));
        
        if (currentPhase === "chapter_content" && progress.current_result) {
          const title = (progress.current_result.display_content.title as string) || "";
          const chapterNum = writerState.completedChapterCount + 1;
          
          const locationMessage = formatMessage(
            t("smart_writer_content_generated_location"),
            { chapterNum: chapterNum, title: title || t("workflow_field_untitled") }
          );
          
          updateMessage(assistantMsgId, { 
            content: locationMessage, 
            isStreaming: false,
          });
        } else if (progress.current_result) {
          const resultMsg = formatPhaseResult(progress.current_result, progress.current_phase);
          updateMessage(assistantMsgId, { 
            content: resultMsg, 
            isStreaming: false,
            isEditable: progress.current_result.editable_fields.length > 0,
            editableContent: Object.fromEntries(
              progress.current_result.editable_fields.map((f) => [
                f,
                String(progress.current_result?.display_content[f] || ""),
              ])
            ),
          });
        }
        
        return progress;
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      updateMessage(assistantMsgId, {
        content: `${t("workflow_execute_failed")}: ${err.message}`,
        isStreaming: false,
        role: "error",
      });
      return null;
    } finally {
      setIsBusy(false);
      setIsStreaming(false);
    }
  }, [novelId, addAssistantMessage, updateMessage, formatPhaseResult, writerState.completedChapterCount, t]);
  
  const confirmAndProceed = useCallback(async (workflowId: string, modifications?: Record<string, unknown>) => {
    setIsBusy(true);
    
    try {
      const result = await confirmPhase(novelId, workflowId, {
        user_modifications: modifications,
      });
      
      setWriterState((prev) => ({
        ...prev,
        progress: result.progress,
        isWaiting: result.progress.status === "waiting_user_confirm",
      }));
      
      if (result.success) {
        if (result.next_phase) {
          addSystemMessage(t("smart_writer_confirmed_next"));
          return { shouldContinue: true, nextPhase: result.next_phase };
        } else {
          addSystemMessage(t("smart_writer_chapter_complete"));
          return { shouldContinue: false, isComplete: true };
        }
      }
      
      return { shouldContinue: false };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      addErrorMessage(`${t("workflow_confirm_failed")}: ${err.message}`);
      return { shouldContinue: false };
    } finally {
      setIsBusy(false);
    }
  }, [novelId, addSystemMessage, addErrorMessage, t]);
  
  const handleSaveChapter = useCallback(async () => {
    if (!writerState.workflowId) return;
    
    Modal.confirm({
      title: t("workflow_save_confirm_title"),
      content: t("workflow_save_confirm_message"),
      okText: t("common_save"),
      cancelText: t("common_cancel"),
      onOk: async () => {
        setIsBusy(true);
        try {
          const result = await saveWorkflowChapter(novelId, writerState.workflowId!);
          if (result.success && result.chapter) {
            addSystemMessage(t("workflow_save_success"));
            onChapterSaved?.(result.chapter);
            
            setWriterState((prev) => ({
              ...prev,
              completedChapterCount: prev.completedChapterCount + 1,
              currentChapter: null,
            }));
            
            if (writerState.completedChapterCount + 1 < writerState.targetChapterCount) {
              addAssistantMessage(t("smart_writer_continue_next_chapter"));
            } else {
              addSystemMessage(t("smart_writer_all_complete"));
              setStoredSession(novelId, null);
              setWriterState((prev) => ({ ...prev, workflowId: null, progress: null }));
            }
          }
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          addErrorMessage(`${t("common_error")}: ${err.message}`);
        } finally {
          setIsBusy(false);
        }
      },
    });
  }, [writerState.workflowId, writerState.completedChapterCount, writerState.targetChapterCount, novelId, addSystemMessage, addAssistantMessage, addErrorMessage, onChapterSaved, t]);
  
  const handleSendMessage = useCallback(async () => {
    const text = inputValue.trim();
    if (!text || isBusy) return;
    
    setInputValue("");
    addMessage("user", text);
    
    const { type, params } = parseInstruction(text);
    
    switch (type) {
      case "generate_multiple":
      case "generate_one": {
        const count = (params.count as number) || 1;
        
        if (writerState.workflowId && writerState.isWaiting) {
          addSystemMessage(t("smart_writer_existing_session"));
          return;
        }
        
        if (writerState.workflowId) {
          addSystemMessage(t("smart_writer_cancel_prev"));
        }
        
        await createWriterWorkflow(count);
        
        if (writerState.workflowId) {
          const progress = await executeCurrentPhase(writerState.workflowId);
          if (progress && progress.status === "waiting_user_confirm") {
            addSystemMessage(t("smart_writer_check_and_confirm"));
          }
        }
        break;
      }
      
      case "confirm": {
        if (!writerState.workflowId) {
          addErrorMessage(t("smart_writer_no_active_session"));
          return;
        }
        
        if (writerState.progress?.status === "waiting_user_confirm") {
          const modifications = Object.keys(editFields).length > 0 ? editFields : undefined;
          
          if (writerState.progress.current_phase === "chapter_content" || 
              writerState.progress.current_phase === "polish") {
            addSystemMessage(t("smart_writer_confirm_save"));
          } else {
            const { shouldContinue, nextPhase } = await confirmAndProceed(
              writerState.workflowId, 
              modifications
            );
            
            if (shouldContinue && nextPhase) {
              setEditFields({});
              setEditMode(false);
              await executeCurrentPhase(writerState.workflowId);
            }
          }
        } else {
          addErrorMessage(t("smart_writer_nothing_to_confirm"));
        }
        break;
      }
      
      case "save": {
        if (!writerState.workflowId) {
          addErrorMessage(t("smart_writer_no_active_session"));
          return;
        }
        await handleSaveChapter();
        break;
      }
      
      case "modify": {
        if (!writerState.workflowId) {
          addErrorMessage(t("smart_writer_no_active_session"));
          return;
        }
        
        addSystemMessage(t("smart_writer_enter_edit_mode"));
        setEditMode(true);
        break;
      }
      
      case "cancel": {
        if (writerState.workflowId) {
          setStoredSession(novelId, null);
          setWriterState({
            workflowId: null,
            progress: null,
            targetChapterCount: 0,
            completedChapterCount: 0,
            currentChapter: null,
            isWaiting: false,
          });
          setEditFields({});
          setEditMode(false);
          addSystemMessage(t("smart_writer_session_cancelled"));
        } else {
          addSystemMessage(t("smart_writer_no_active_session"));
        }
        break;
      }
      
      case "question":
      default: {
        addAssistantMessage(t("smart_writer_help_text"));
        break;
      }
    }
  }, [
    inputValue, 
    isBusy, 
    addMessage, 
    addSystemMessage, 
    addAssistantMessage, 
    addErrorMessage,
    writerState,
    editFields,
    createWriterWorkflow,
    executeCurrentPhase,
    confirmAndProceed,
    handleSaveChapter,
    novelId,
    t,
  ]);
  
  const handleEditFieldChange = useCallback((field: string, value: string) => {
    setEditFields((prev) => ({ ...prev, [field]: value }));
  }, []);
  
  const handleQuickAction = useCallback((action: string) => {
    switch (action) {
      case "confirm":
        setInputValue(t("smart_writer_quick_confirm"));
        break;
      case "save":
        setInputValue(t("smart_writer_quick_save"));
        break;
      case "edit":
        setInputValue(t("smart_writer_quick_modify"));
        break;
      case "cancel":
        setInputValue(t("smart_writer_quick_cancel"));
        break;
    }
  }, [t]);
  
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    
    const stored = getStoredSession(novelId);
    if (stored?.workflowId) {
      setWriterState((prev) => ({ ...prev, workflowId: stored.workflowId }));
      addSystemMessage(t("smart_writer_restore_session"));
      
      fetchWorkflowProgress(novelId, stored.workflowId).then((progress) => {
        setWriterState((prev) => ({
          ...prev,
          progress,
          isWaiting: progress.status === "waiting_user_confirm",
        }));
        
        if (progress.current_result) {
          const resultMsg = formatPhaseResult(progress.current_result, progress.current_phase);
          addAssistantMessage(resultMsg, {
            isEditable: progress.current_result.editable_fields.length > 0,
            editableContent: Object.fromEntries(
              progress.current_result.editable_fields.map((f) => [
                f,
                String(progress.current_result?.display_content[f] || ""),
              ])
            ),
          });
          addSystemMessage(t("smart_writer_check_and_confirm"));
        }
      }).catch(() => {
        setStoredSession(novelId, null);
        setWriterState((prev) => ({ ...prev, workflowId: null }));
      });
    } else {
      addAssistantMessage(t("smart_writer_welcome"));
    }
  }, [novelId, addSystemMessage, addAssistantMessage, formatPhaseResult, t]);
  
  const getMessageStyle = (role: MessageRole): string => {
    switch (role) {
      case "user":
        return "smart-writer-bubble--user";
      case "assistant":
        return "smart-writer-bubble--assistant";
      case "system":
        return "smart-writer-bubble--system";
      case "error":
        return "smart-writer-bubble--error";
      default:
        return "";
    }
  };
  
  return (
    <div className="smart-writer-panel">
      <div className="smart-writer-header">
        <div className="smart-writer-header__title">
          <span className="smart-writer-header__icon">🤖</span>
          <span>{t("smart_writer_title")}</span>
        </div>
        {writerState.targetChapterCount > 0 && (
          <div className="smart-writer-header__status">
            {formatMessage(t("smart_writer_progress"), {
              done: writerState.completedChapterCount,
              total: writerState.targetChapterCount,
            })}
          </div>
        )}
      </div>
      
      <div className="smart-writer-messages">
        {messages.map((msg) => (
          <div key={msg.id} className={`smart-writer-bubble ${getMessageStyle(msg.role)}`}>
            <div className="smart-writer-bubble__content">{msg.content}</div>
            
            {msg.isEditable && msg.editableContent && !msg.isStreaming && (
              <div className="smart-writer-bubble__editable">
                {Object.entries(msg.editableContent).map(([field, value]) => (
                  <div key={field} className="smart-writer-edit-field">
                    <label className="smart-writer-edit-field__label">
                      {t(`workflow_field_${field}`) || field}
                    </label>
                    {field === "body" ? (
                      <textarea
                        className="smart-writer-edit-field__textarea"
                        value={editFields[field] ?? value}
                        onChange={(e) => handleEditFieldChange(field, e.target.value)}
                        rows={6}
                        disabled={!editMode && isBusy}
                      />
                    ) : (
                      <input
                        type="text"
                        className="smart-writer-edit-field__input"
                        value={editFields[field] ?? value}
                        onChange={(e) => handleEditFieldChange(field, e.target.value)}
                        disabled={!editMode && isBusy}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      
      {writerState.isWaiting && (
        <div className="smart-writer-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => handleQuickAction("confirm")}
            disabled={isBusy}
          >
            {t("smart_writer_action_confirm")}
          </button>
          {writerState.progress && 
           (writerState.progress.current_phase === "chapter_content" || 
            writerState.progress.current_phase === "polish") && (
            <button
              type="button"
              className="btn btn-default"
              onClick={handleSaveChapter}
              disabled={isBusy}
            >
              {t("smart_writer_action_save")}
            </button>
          )}
          <button
            type="button"
            className="btn btn-default"
            onClick={() => setEditMode(!editMode)}
            disabled={isBusy}
          >
            {editMode ? t("smart_writer_action_done_editing") : t("smart_writer_action_edit")}
          </button>
          <button
            type="button"
            className="btn btn-default"
            onClick={() => handleQuickAction("cancel")}
            disabled={isBusy}
          >
            {t("smart_writer_action_cancel")}
          </button>
        </div>
      )}
      
      <div className="smart-writer-input">
        <textarea
          ref={inputRef}
          className="smart-writer-input__textarea"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder={t("smart_writer_placeholder")}
          disabled={isBusy || isStreaming}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSendMessage();
            }
          }}
          rows={2}
        />
        <button
          type="button"
          className="smart-writer-input__send btn btn-primary"
          onClick={handleSendMessage}
          disabled={isBusy || isStreaming || !inputValue.trim()}
        >
          {t("write_ask_send")}
        </button>
      </div>
      
      {!writerState.workflowId && (
        <div className="smart-writer-suggestions">
          <p className="smart-writer-suggestions__label">{t("smart_writer_try_these")}</p>
          <div className="smart-writer-suggestions__list">
            <button
              type="button"
              className="smart-writer-suggestions__item"
              onClick={() => setInputValue(t("smart_writer_suggestion_1"))}
            >
              {t("smart_writer_suggestion_1")}
            </button>
            <button
              type="button"
              className="smart-writer-suggestions__item"
              onClick={() => setInputValue(t("smart_writer_suggestion_2"))}
            >
              {t("smart_writer_suggestion_2")}
            </button>
            <button
              type="button"
              className="smart-writer-suggestions__item"
              onClick={() => setInputValue(t("smart_writer_suggestion_3"))}
            >
              {t("smart_writer_suggestion_3")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
