import { TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { MessageSquare, Send } from "lucide-react";

const ChatTab = () => {
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant', content: string }>>([]);
  const [input, setInput] = useState('');

  const handleSend = () => {
    if (!input.trim()) return;
    
    // Add user message
    setMessages(prev => [...prev, { role: 'user', content: input }]);
    setInput('');
    
    // TODO: Implement actual AI chat functionality
    // For now, just add a mock response
    setTimeout(() => {
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: "I'm a mock AI assistant response. The actual AI chat functionality will be implemented later." 
      }]);
    }, 1000);
  };

  return (
    <TabsContent value="chat" className="h-full flex flex-col">
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {messages.map((message, index) => (
          <div
            key={index}
            className={`flex ${message.role === 'assistant' ? 'justify-start' : 'justify-end'}`}
          >
            <div
              className={`max-w-[80%] p-3 rounded-lg ${
                message.role === 'assistant'
                  ? 'bg-gray-100 text-gray-900'
                  : 'bg-blue-500 text-white'
              }`}
            >
              {message.content}
            </div>
          </div>
        ))}
      </div>
      <div className="p-4 border-t">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="flex gap-2"
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your message..."
            className="flex-1"
          />
          <Button type="submit">
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </TabsContent>
  );
};

export default ChatTab; 