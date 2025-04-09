import { TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState, useEffect, useRef } from "react";
import { MessageSquare, Send } from "lucide-react";
import { Tool } from "@modelcontextprotocol/sdk/types.js";

interface ChatTabProps {
  tools?: Tool[];
  callTool?: (name: string, params: Record<string, unknown>) => Promise<any>;
}

interface Message {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
}

const ChatTab = ({ tools, callTool }: ChatTabProps) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    // Connect to the agent service
    const connectWebSocket = () => {
      const ws = new WebSocket('ws://localhost:3001/chat');

      ws.onopen = () => {
        console.log('Connected to agent service');
        setIsConnected(true);
      };

      ws.onclose = () => {
        console.log('Disconnected from agent service');
        setIsConnected(false);
        // Try to reconnect in 5 seconds
        setTimeout(connectWebSocket, 5000);
      };

      ws.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        
        if (data.type === 'tool_call') {
          // Handle tool call request from agent
          try {
            const toolResult = await callTool?.(
              data.data.tool,
              data.data.params
            );
            ws.send(JSON.stringify(toolResult));
          } catch (error) {
            console.error('Tool call failed:', error);
            ws.send(JSON.stringify({ error: 'Tool call failed' }));
          }
        } else if (data.type === 'message') {
          // Handle assistant message
          setMessages(prev => [...prev, data.data]);
          setIsLoading(false);
        }
      };

      wsRef.current = ws;
    };

    connectWebSocket();

    return () => {
      wsRef.current?.close();
    };
  }, [callTool]);

  const handleSend = async () => {
    if (!input.trim() || isLoading || !isConnected) return;
    
    // Add user message
    setMessages(prev => [...prev, { role: 'user', content: input }]);
    setInput('');
    setIsLoading(true);

    // Send message to agent
    wsRef.current?.send(JSON.stringify({
      content: input
    }));
  };

  return (
    <TabsContent value="chat" className="h-full flex flex-col">
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {messages.map((message, index) => (
          <div
            key={index}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] p-3 rounded-lg ${
                message.role === 'user'
                  ? 'bg-blue-500 text-white'
                  : message.role === 'tool'
                  ? 'bg-green-100 text-gray-900 border border-green-200'
                  : 'bg-gray-100 text-gray-900'
              }`}
            >
              {message.toolName && (
                <div className="text-xs text-gray-500 mb-1">
                  Tool: {message.toolName}
                </div>
              )}
              {message.content}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 text-gray-900 p-3 rounded-lg">
              Thinking...
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      <div className="p-4 border-t">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSend();
          }}
          className="flex gap-2"
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={isConnected ? "Ask me anything..." : "Connecting to agent..."}
            className="flex-1"
            disabled={isLoading || !isConnected}
          />
          <Button type="submit" disabled={isLoading || !isConnected}>
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </TabsContent>
  );
};

export default ChatTab; 