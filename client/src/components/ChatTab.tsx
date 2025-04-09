import { TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { GoogleGenerativeAI } from "@google/generative-ai";

// Initialize Google Gemini
const genAI = new GoogleGenerativeAI('AIzaSyADOkwl1FJm_jcZvH23gmUrCAcKQPrnLv4');

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const ChatTab = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const sendMessage = async () => {
    if (!input.trim()) return;

    try {
      setIsLoading(true);
      
      // Add user message
      const userMessage: Message = { role: 'user', content: input };
      setMessages(prev => [...prev, userMessage]);
      setInput('');

      // Get Gemini response
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
      
      try {
        const result = await model.generateContent(input);
        if (!result || !result.response) {
          throw new Error('No response received from Gemini');
        }
        const response = await result.response;
        const text = response.text();

        // Add assistant message
        const assistantMessage: Message = { role: 'assistant', content: text };
        setMessages(prev => [...prev, assistantMessage]);
      } catch (apiError) {
        console.error('Gemini API Error:', apiError);
        const errorMessage: Message = { 
          role: 'assistant', 
          content: `Error from Gemini API: ${apiError instanceof Error ? apiError.message : 'Unknown error'}. This might be due to API key restrictions or network issues.`
        };
        setMessages(prev => [...prev, errorMessage]);
      }

    } catch (error) {
      console.error('General Error:', error);
      const errorMessage: Message = { 
        role: 'assistant', 
        content: `An error occurred: ${error instanceof Error ? error.message : 'Unknown error'}. Please check the console for more details.`
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <TabsContent value="chat" className="flex flex-col h-full">
      <div className="flex flex-col h-[calc(100vh-20rem)] bg-card rounded-lg border shadow-sm">
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((message, index) => (
            <div
              key={index}
              className={`flex ${
                message.role === 'user' ? 'justify-end' : 'justify-start'
              }`}
            >
              <div
                className={`max-w-[80%] p-3 rounded-lg ${
                  message.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {message.content}
              </div>
            </div>
          ))}
        </div>
        <div className="p-4 border-t mt-auto">
          <div className="flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && !isLoading && sendMessage()}
              placeholder="Type your message..."
              disabled={isLoading}
              className="flex-1"
            />
            <Button 
              onClick={sendMessage}
              disabled={isLoading || !input.trim()}
            >
              {isLoading ? 'Sending...' : 'Send'}
            </Button>
          </div>
        </div>
      </div>
    </TabsContent>
  );
};

export default ChatTab; 