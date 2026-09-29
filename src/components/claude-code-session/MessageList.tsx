import React, { useRef, useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useVirtualizer } from '@tanstack/react-virtual';
import { StreamMessage } from '../StreamMessage';
import { Terminal } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ClaudeStreamMessage } from '../AgentExecution';

// ── 工具轮次折叠 ──
// 长 agent 任务的每一轮（助手碎碎念 + 工具调用 + 工具结果）都会各占一张大卡片，
// 几十轮下来刷屏。这里把连续的工具轮次归并成一个可展开的"执行过程"块：
// 折叠时只显示步骤数与工具统计，展开时用 StreamMessage 原样渲染每一轮细节。

type DisplayItem =
  | { kind: 'msg'; msg: ClaudeStreamMessage; index: number }
  | { kind: 'steps'; items: ClaudeStreamMessage[]; startIndex: number };

const hasToolUse = (m: ClaudeStreamMessage): boolean =>
  !!m && Array.isArray(m.message?.content) &&
  m.message.content.some((c: any) => c?.type === 'tool_use');

const isToolResultMessage = (m: ClaudeStreamMessage): boolean =>
  m?.type === 'user' && Array.isArray(m.message?.content) &&
  m.message.content.some((c: any) => c?.type === 'tool_result');

const shortToolName = (name: string): string =>
  name.startsWith('mcp__') ? name.split('__').slice(2).join('_') || name : name;

function groupDisplayItems(messages: ClaudeStreamMessage[]): DisplayItem[] {
  const items: DisplayItem[] = [];
  let group: ClaudeStreamMessage[] = [];
  let groupStart = 0;
  const flush = () => {
    if (group.length > 0) {
      items.push({ kind: 'steps', items: group, startIndex: groupStart });
      group = [];
    }
  };
  messages.forEach((m, index) => {
    if (hasToolUse(m)) {
      if (group.length === 0) groupStart = index;
      group.push(m);
      return;
    }
    if (m.type === 'user' && isToolResultMessage(m) && group.length > 0) {
      group.push(m);
      return;
    }
    flush();
    items.push({ kind: 'msg', msg: m, index });
  });
  flush();
  return items;
}

// ToolRounds 折叠块：头部是步骤数与工具统计，展开后逐轮原样渲染。
const ToolRounds: React.FC<{
  items: ClaudeStreamMessage[];
  onLinkDetected?: (url: string) => void;
}> = ({ items, onLinkDetected }) => {
  const [open, setOpen] = useState(false);
  const toolCounts: Record<string, number> = {};
  let steps = 0;
  items.forEach((m) => {
    (m?.message?.content || []).forEach((c: any) => {
      if (c?.type === 'tool_use') {
        steps += 1;
        const n = shortToolName(c.name || '?');
        toolCounts[n] = (toolCounts[n] || 0) + 1;
      }
    });
  });
  const summary = Object.entries(toolCounts)
    .map(([n, c]) => `${n}×${c}`)
    .join(' · ');

  return (
    <div className="border border-border/40 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:bg-muted/40 transition-colors"
      >
        {open ? '▾' : '▸'}
        <span className="font-medium">执行过程 · {steps} 步</span>
        <span className="truncate opacity-70">{summary}</span>
      </button>
      {open && (
        <div className="px-2 py-1 space-y-1 border-t border-border/40 bg-background/40">
          {items.map((m, i) => (
            <StreamMessage
              key={`step-${i}`}
              message={m}
              streamMessages={items}
              onLinkDetected={onLinkDetected}
            />
          ))}
        </div>
      )}
    </div>
  );
};

interface MessageListProps {
  messages: ClaudeStreamMessage[];
  projectPath: string;
  isStreaming: boolean;
  onLinkDetected?: (url: string) => void;
  className?: string;
}

export const MessageList: React.FC<MessageListProps> = React.memo(({
  messages,
  projectPath,
  isStreaming,
  onLinkDetected,
  className
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const userHasScrolledRef = useRef(false);

  // 折叠工具轮次后的显示项（原始 messages 不变，仅渲染层分组）
  const displayItems = useMemo(() => groupDisplayItems(messages), [messages]);

  // Virtual scrolling setup
  const virtualizer = useVirtualizer({
    count: displayItems.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 100, // Estimated height of each message
    overscan: 5,
  });

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (shouldAutoScrollRef.current && scrollContainerRef.current) {
      const scrollElement = scrollContainerRef.current;
      scrollElement.scrollTop = scrollElement.scrollHeight;
    }
  }, [messages]);

  // Handle scroll events to detect user scrolling
  const handleScroll = () => {
    if (!scrollContainerRef.current) return;
    
    const scrollElement = scrollContainerRef.current;
    const isAtBottom = 
      Math.abs(scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight) < 50;
    
    if (!isAtBottom) {
      userHasScrolledRef.current = true;
      shouldAutoScrollRef.current = false;
    } else if (userHasScrolledRef.current) {
      shouldAutoScrollRef.current = true;
      userHasScrolledRef.current = false;
    }
  };

  // Reset auto-scroll when streaming stops
  useEffect(() => {
    if (!isStreaming) {
      shouldAutoScrollRef.current = true;
      userHasScrolledRef.current = false;
    }
  }, [isStreaming]);

  if (messages.length === 0) {
    return (
      <div className={cn("flex-1 flex items-center justify-center", className)}>
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center space-y-4 max-w-md"
        >
          <div className="h-16 w-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto">
            <Terminal className="h-8 w-8 text-primary" />
          </div>
          <div>
            <h3 className="text-lg font-semibold mb-2">准备开始编码</h3>
            <p className="text-sm text-muted-foreground">
              {projectPath 
                ? "在下方输入提示词，开始你的 Claude Code 会话"
                : "选择一个项目文件夹以开始"}
            </p>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div
      ref={scrollContainerRef}
      onScroll={handleScroll}
      className={cn("flex-1 overflow-y-auto scroll-smooth", className)}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        <AnimatePresence mode="popLayout">
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const item = displayItems[virtualItem.index];
            const key = `item-${virtualItem.index}-${item.kind}`;

            return (
              <motion.div
                key={key}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.2 }}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualItem.start}px)`,
                }}
              >
                <div className="px-4 py-2">
                  {item.kind === 'msg' ? (
                    <StreamMessage
                      message={item.msg}
                      streamMessages={messages}
                      onLinkDetected={onLinkDetected}
                    />
                  ) : (
                    <ToolRounds
                      items={item.items}
                      onLinkDetected={onLinkDetected}
                    />
                  )}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Streaming indicator */}
      {isStreaming && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="sticky bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-background to-transparent"
        >
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <div className="h-2 w-2 bg-primary rounded-full animate-pulse" />
            <ElapsedCounter />
          </div>
        </motion.div>
      )}
    </div>
  );
});

// ElapsedCounter 流式等待计时：让"模型在思考"与"请求卡住"可区分——
// 超过 90 秒无任何流事件时提示可能卡住（后端看门狗默认 300 秒自动终止）。
const ElapsedCounter: React.FC = () => {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const mm = Math.floor(elapsed / 60);
  const ss = elapsed % 60;
  const stuck = elapsed >= 90;
  return (
    <span className={stuck ? 'text-yellow-500' : undefined}>
      Claude 正在思考…（已等待 {mm > 0 ? `${mm} 分 ` : ''}{ss} 秒
      {stuck ? '，无输出疑似卡住，超时将自动终止' : ''}）
    </span>
  );
};