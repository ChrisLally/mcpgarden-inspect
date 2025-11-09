import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scrollarea";
import { Info } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { TabsContent } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { Loader2, Eye, EyeOff, Key, AlertCircle } from "lucide-react";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  ListToolsResultSchema,
  CompatibilityCallToolResultSchema,
  ClientRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { ConnectionStatus } from "@/lib/constants";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Storage keys
const API_KEY_STORAGE_KEY = "gemini-api-key";
const MODEL_STORAGE_KEY = "gemini-model-choice";

// Available Gemini models
const GEMINI_MODELS = [
  {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    description: "Latest generation, fast and efficient",
  },
  {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    description: "Latest generation, enhanced reasoning and multimodal",
  },
];

// Create provider instance - will be initialized in useEffect
let googleAI: GoogleGenerativeAI | null = null;

// Define message types
type MessageRole = "user" | "assistant";
interface Message {
  role: MessageRole;
  content: string;
}

// Types for Gemini API
interface ModelConfig {
  temperature: number;
}

interface FunctionCall {
  name: string;
  args: Record<string, unknown>;
  rawResult?: unknown;
}

// Define custom tool types to match Gemini's expectations
interface ToolParameters {
  type: string;
  properties: Record<string, unknown>;
  required?: string[];
}

interface GeminiTool {
  name: string;
  description: string;
  parameters: ToolParameters;
}

interface GenerationRequest {
  contents: {
    role: string;
    parts: { text: string }[];
  }[];
  generationConfig: ModelConfig;
  tools?: {
    functionDeclarations: GeminiTool[];
  }[];
}

interface ChatTabProps {
  mcpClient: Client | null;
  makeRequest: <T extends z.ZodType>(
    request: ClientRequest,
    schema: T,
    options?: {
      signal?: AbortSignal;
      suppressToast?: boolean;
      resetTimeoutOnProgress?: boolean;
      timeout?: number;
      maxTotalTimeout?: number;
    },
  ) => Promise<z.output<T>>;
  connectionStatus: ConnectionStatus;
}

// Add type for schema properties
interface SchemaProperty {
  type?: string;
  description?: string;
  [key: string]: unknown;
}

interface InputSchema {
  type?: string;
  properties?: Record<string, SchemaProperty>;
  required?: string[];
  [key: string]: unknown;
}

// Add type for Gemini property schema
interface GeminiProperty {
  type: string;
  description: string;
}

// Custom keyframe animation for the button border
const keyframeStyle = `
@keyframes borderMove {
  0% { 
    background-position: 0% 50%;
  }
  50% { 
    background-position: 100% 50%;
  }
  100% { 
    background-position: 0% 50%;
  }
}

.animated-border {
  position: relative;
  z-index: 0;
  transition: all 0.3s ease;
}

.animated-border:before {
  content: "";
  position: absolute;
  z-index: -1;
  inset: 0;
  padding: 1px;
  border-radius: 4px;
  background: linear-gradient(90deg, var(--primary), var(--accent), var(--primary));
  background-size: 200% 200%;
  animation: borderMove 3s ease-in-out infinite;
  -webkit-mask: 
    linear-gradient(#fff 0 0) content-box, 
    linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
}

.animated-border:hover:before {
  background-size: 150% 150%;
  animation-duration: 2s;
}
`;

const ChatTab = ({
  mcpClient,
  makeRequest,
  connectionStatus,
}: ChatTabProps) => {
  // State for messages in the chat
  const [messages, setMessages] = useState<Message[]>([]);
  // State for the user's current input
  const [input, setInput] = useState("");
  // State to track if the AI is currently generating a response
  const [isLoading, setIsLoading] = useState(false);
  // Ref for the end of the messages list to enable auto-scrolling
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // State for tools with custom type
  const [tools, setTools] = useState<GeminiTool[]>([]);
  // State for tools loading
  const [toolsLoaded, setToolsLoaded] = useState(false);
  // State for debugging info
  const [debugInfo, setDebugInfo] = useState<string>("");
  // State for managing the API key
  const [apiKey, setApiKey] = useState<string>("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKeyInputVisible, setApiKeyInputVisible] = useState(false);
  const [apiKeyInputValue, setApiKeyInputValue] = useState("");
  // State for managing model selection
  const [selectedModel, setSelectedModel] =
    useState<string>("gemini-2.5-flash");
  const [customModelInput, setCustomModelInput] = useState<string>("");
  const [useCustomModel, setUseCustomModel] = useState<boolean>(false);

  // State for selected tools (tool name -> boolean)
  const [selectedTools, setSelectedTools] = useState<Record<string, boolean>>(
    {},
  );
  // State for the tool being previewed in the dialog
  const [previewTool, setPreviewTool] = useState<GeminiTool | null>(null);
  // Initialize googleAI, load saved API key and model preference on component mount
  useEffect(() => {
    // Load API key from localStorage if available
    const savedApiKey = localStorage.getItem(API_KEY_STORAGE_KEY);
    if (savedApiKey) {
      setApiKey(savedApiKey);
      googleAI = new GoogleGenerativeAI(savedApiKey);
    } else if (import.meta.env.VITE_GOOGLE_GENERATIVE_AI_API_KEY) {
      // Fall back to env variable if available
      googleAI = new GoogleGenerativeAI(
        import.meta.env.VITE_GOOGLE_GENERATIVE_AI_API_KEY,
      );
    }

    // Load model preference
    const savedModel = localStorage.getItem(MODEL_STORAGE_KEY);
    const savedUseCustom =
      localStorage.getItem("gemini-use-custom-model") === "true";
    const savedCustomModel = localStorage.getItem("gemini-custom-model") || "";

    if (savedUseCustom && savedCustomModel) {
      setUseCustomModel(true);
      setCustomModelInput(savedCustomModel);
    } else if (
      savedModel &&
      GEMINI_MODELS.some((model) => model.id === savedModel)
    ) {
      setSelectedModel(savedModel);
    }
  }, []);

  // Function to mask API key for display
  const getMaskedApiKey = (key: string) => {
    if (!key || key.length < 8) return "";
    return `${key.substring(0, 4)}${"*".repeat(key.length - 8)}${key.substring(key.length - 4)}`;
  };

  // Handle saving new API key
  const handleSaveApiKey = () => {
    if (apiKeyInputValue.trim()) {
      const newKey = apiKeyInputValue.trim();
      localStorage.setItem(API_KEY_STORAGE_KEY, newKey);
      setApiKey(newKey);
      googleAI = new GoogleGenerativeAI(newKey);
      setApiKeyInputVisible(false);
      setApiKeyInputValue("");
      setShowApiKey(false);
    }
  };

  // Handle removing API key
  const handleRemoveApiKey = () => {
    localStorage.removeItem(API_KEY_STORAGE_KEY);
    setApiKey("");
    // Fall back to env variable if available
    if (import.meta.env.VITE_GOOGLE_GENERATIVE_AI_API_KEY) {
      googleAI = new GoogleGenerativeAI(
        import.meta.env.VITE_GOOGLE_GENERATIVE_AI_API_KEY,
      );
    } else {
      googleAI = null;
    }
    setShowApiKey(false);
  };

  // Handle model change
  const handleModelChange = (model: string) => {
    if (model === "__custom__") {
      setUseCustomModel(true);
      return;
    }
    setSelectedModel(model);
    setUseCustomModel(false);
    localStorage.setItem(MODEL_STORAGE_KEY, model);
    localStorage.setItem("gemini-use-custom-model", "false");
  };

  // Handle custom model input
  const handleCustomModelChange = (value: string) => {
    setCustomModelInput(value);
    if (value.trim()) {
      localStorage.setItem("gemini-custom-model", value.trim());
      localStorage.setItem("gemini-use-custom-model", "true");
    }
  };

  // Effect to load tools when mcpClient is connected
  useEffect(() => {
    const loadTools = async () => {
      if (connectionStatus === "connected" && mcpClient && !toolsLoaded) {
        try {
          const toolsResult = await makeRequest(
            { method: "tools/list" },
            ListToolsResultSchema,
          );

          console.log("MCP tools response:", toolsResult);

          // Convert MCP tools to Google GenAI tool format
          if (toolsResult?.tools?.length > 0) {
            const geminiTools = toolsResult.tools.map((tool) => {
              // Create a properties object that follows Gemini's structure
              const schemaProperties: Record<string, GeminiProperty> = {};

              // Process input schema properties if available
              const inputSchema = (tool.inputSchema as InputSchema) || {};
              if (inputSchema && inputSchema.properties) {
                // Convert each property to Gemini's expected format
                Object.entries(inputSchema.properties).forEach(
                  ([propName, propSchema]) => {
                    // Skip special properties
                    if (
                      ["additionalProperties", "$schema"].includes(propName)
                    ) {
                      return;
                    }

                    // Determine the property type
                    let type = propSchema.type || "string";

                    // Map types to Gemini's supported types (STRING, NUMBER, BOOLEAN, etc.)
                    if (type === "string") type = "STRING";
                    else if (type === "number" || type === "integer")
                      type = "NUMBER";
                    else if (type === "boolean") type = "BOOLEAN";
                    else if (type === "array") type = "ARRAY";
                    else if (type === "object") type = "OBJECT";
                    else type = "STRING"; // Default to STRING

                    // Create the property schema
                    schemaProperties[propName] = {
                      type,
                      description:
                        propSchema.description || `Parameter: ${propName}`,
                    };
                  },
                );
              }

              return {
                name: tool.name,
                description: tool.description || `MCP tool: ${tool.name}`,
                parameters: {
                  type: "OBJECT",
                  properties: schemaProperties,
                  required: Array.isArray(inputSchema.required)
                    ? inputSchema.required
                    : [],
                },
              };
            });

            setTools(geminiTools);
            // Initialize selectedTools state with all tools selected by default
            const initialSelected: Record<string, boolean> = {};
            geminiTools.forEach((tool) => {
              initialSelected[tool.name] = true;
            });
            setSelectedTools(initialSelected);
            console.log("MCP tools prepared for Google GenAI:", geminiTools);
            setDebugInfo(
              `Loaded ${geminiTools.length} tools: ${JSON.stringify(geminiTools, null, 2)}`,
            );
          } else {
            // Handle case where no tools are found
            setTools([]);
            setSelectedTools({});
          }
          setToolsLoaded(true);
        } catch (err) {
          console.error("Error loading MCP tools:", err);
          setDebugInfo(`Error loading tools: ${err}`);
          setToolsLoaded(true); // Still mark as loaded so we don't keep retrying
        }
      }
    };

    loadTools();
  }, [connectionStatus, mcpClient, makeRequest, toolsLoaded]);

  // Effect to scroll to the bottom whenever messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Update input state as user types
  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setInput(event.target.value);
  };

  // Handle form submission (sending a message)
  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Prevent sending empty messages or sending while loading
    if (!input.trim() || isLoading) return;

    setDebugInfo(""); // Clear debug info for new request

    // Filter tools based on selection state
    const activeTools = tools.filter((tool) => selectedTools[tool.name]);

    // Add user message to the chat history immediately for responsiveness
    const newUserMessage: Message = { role: "user", content: input };
    const updatedMessages = [...messages, newUserMessage];
    setMessages(updatedMessages);

    setInput(""); // Clear input field
    setIsLoading(true); // Show loading indicator

    try {
      setDebugInfo(
        `Sending message to Gemini with ${activeTools.length} active tools out of ${tools.length} available`,
      );

      // Format history for Google GenAI
      const formattedMessages = updatedMessages.map((msg) => ({
        role: msg.role === "user" ? "user" : "model",
        parts: [{ text: msg.content }],
      }));

      // Select model
      if (!googleAI) {
        throw new Error("Google AI client not initialized");
      }

      const modelToUse =
        useCustomModel && customModelInput.trim()
          ? customModelInput.trim()
          : selectedModel;

      const model = googleAI.getGenerativeModel({
        model: modelToUse,
        systemInstruction:
          activeTools.length > 0 // Use activeTools count
            ? "You can use tools to help answer the user's question. Use tools whenever they would be helpful."
            : undefined,
      });

      // Configure model request
      const modelConfig: ModelConfig = {
        temperature: 0.2,
      };

      // Create request configuration with proper typing
      const requestConfig: GenerationRequest = {
        contents: formattedMessages,
        generationConfig: modelConfig,
      };

      // Add *active* tools if available - outside of generationConfig
      if (activeTools.length > 0) {
        requestConfig.tools = [
          {
            functionDeclarations: activeTools, // Send only selected tools
          },
        ];
      }

      // Stream response
      setDebugInfo(
        (prev) =>
          prev +
          `\nSending request to model with tools: ${activeTools.map((t) => t.name).join(", ") || "None"}`,
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const streamingResponse = await model.generateContentStream(
        requestConfig as any,
      );

      let assistantResponse = "";
      let assistantMessageAdded = false;

      setDebugInfo((prev) => prev + "\nStreaming response...");
      // Stream the text
      for await (const chunk of streamingResponse.stream) {
        const chunkText = chunk.text();
        console.log("Chunk:", chunkText || "(empty)");

        if (chunkText) {
          assistantResponse += chunkText;

          if (!assistantMessageAdded) {
            // Add initial message
            setMessages((prev) => [
              ...prev,
              { role: "assistant", content: assistantResponse },
            ]);
            assistantMessageAdded = true;
          } else {
            // Update existing message
            setMessages((prev) => {
              const lastMessageIndex = prev.length - 1;
              const updated = [...prev];
              if (
                lastMessageIndex >= 0 &&
                updated[lastMessageIndex].role === "assistant"
              ) {
                updated[lastMessageIndex] = {
                  ...updated[lastMessageIndex],
                  content: assistantResponse,
                };
              }
              return updated;
            });
          }
        }
      }

      // Get the full response to check for function calls
      const response = await streamingResponse.response;
      console.log("Full response:", response);
      setDebugInfo((prev) => prev + "\nResponse received");

      // Handle function calls
      // Safely extract function calls with proper type handling
      const functionCalls: FunctionCall[] = [];

      // Check if candidates and parts exist before trying to process
      if (response.candidates && response.candidates.length > 0) {
        const candidate = response.candidates[0];
        if (candidate.content && candidate.content.parts) {
          candidate.content.parts.forEach(
            (part: { functionCall?: { name: string; args: unknown } }) => {
              if (part.functionCall) {
                functionCalls.push({
                  name: part.functionCall.name,
                  // Cast the args object to Record<string, unknown>
                  args:
                    (part.functionCall.args as Record<string, unknown>) || {},
                });
              }
            },
          );
        }
      }

      if (functionCalls.length > 0) {
        console.log("Function calls detected:", functionCalls);
        setDebugInfo(
          (prev) =>
            prev +
            "\nFunction calls detected: " +
            JSON.stringify(functionCalls),
        );

        // Process each function call
        for (const functionCall of functionCalls) {
          const toolName = functionCall.name;
          const toolArgs = functionCall.args || {};

          setDebugInfo(
            (prev) =>
              prev +
              `\nCalling tool ${toolName} with args: ${JSON.stringify(toolArgs)}`,
          );

          try {
            // Call the MCP tool
            const result = await makeRequest(
              {
                method: "tools/call",
                params: {
                  name: toolName,
                  arguments: toolArgs,
                  _meta: {
                    progressToken: Date.now(),
                  },
                },
              },
              CompatibilityCallToolResultSchema,
            );

            // Enhanced logging for tool results
            console.log("Tool call executed:", {
              toolName,
              args: toolArgs,
              result,
            });
            setDebugInfo(
              (prev) =>
                prev + `\nTool result: ${JSON.stringify(result, null, 2)}`,
            );

            // Store the raw result for later use in follow-up
            functionCall.rawResult = result;

            // Format tool response as a collapsible element with properly styled code block but original dropdown color
            const toolResponse = `<details class="mt-1">
<summary class="cursor-pointer py-1 px-2 bg-primary/80 text-muted-foreground rounded-t-md font-medium text-sm flex items-center">
  <span class="mr-2">▶</span> Tool Response (${toolName})
</summary>
<pre class="bg-card border border-border rounded-b-md p-3 m-0 overflow-auto text-xs"><code class="text-card-foreground">${JSON.stringify(result, null, 2)}</code></pre>
</details>`;

            setMessages((prev) => {
              const lastMessageIndex = prev.length - 1;
              if (
                lastMessageIndex >= 0 &&
                prev[lastMessageIndex].role === "assistant"
              ) {
                const updated = [...prev];
                updated[lastMessageIndex] = {
                  ...updated[lastMessageIndex],
                  content: updated[lastMessageIndex].content + toolResponse,
                };
                return updated;
              }
              // If there's no assistant message yet (unlikely), add one
              return [...prev, { role: "assistant", content: toolResponse }];
            });
          } catch (error) {
            console.error(`Error executing tool ${toolName}:`, error);
            setDebugInfo(
              (prev) =>
                prev +
                `\nError executing tool: ${error instanceof Error ? error.message : String(error)}`,
            );

            // Append error information to the assistant's response
            const errorMsg = `\n\nError using tool ${toolName}: ${error instanceof Error ? error.message : String(error)}`;
            setMessages((prev) => {
              const lastMessageIndex = prev.length - 1;
              if (
                lastMessageIndex >= 0 &&
                prev[lastMessageIndex].role === "assistant"
              ) {
                const updated = [...prev];
                updated[lastMessageIndex] = {
                  ...updated[lastMessageIndex],
                  content: updated[lastMessageIndex].content + errorMsg,
                };
                return updated;
              }
              return [...prev, { role: "assistant", content: errorMsg }];
            });
          }
        }

        // If we have function calls but no text response or if we need to follow up with tool results
        if (functionCalls.length > 0) {
          // Perform a follow-up call to Gemini to get a coherent response based on tool results
          try {
            setDebugInfo(
              (prev) => prev + "\nGenerating response with tool results...",
            );

            // Create a clean version of the conversation without tool responses
            const cleanedMessages = updatedMessages.map((msg) => ({
              role: msg.role === "user" ? "user" : "model",
              parts: [{ text: msg.content }],
            }));

            // Extract essential information from tool results more directly
            let essentialToolInfo = "";

            // Process tool results using the stored raw results directly
            functionCalls.forEach((call) => {
              if (call.rawResult) {
                // Use the complete raw result object instead of regex extraction
                essentialToolInfo += `${call.name} tool returned: ${JSON.stringify(call.rawResult, null, 2)}\n\n`;
              } else {
                essentialToolInfo += `${call.name} tool was called but no result was captured.\n\n`;
              }
            });

            // Add the essential tool information as context
            if (essentialToolInfo) {
              cleanedMessages.push({
                role: "model",
                parts: [
                  {
                    text: `I have the following information from tools:\n\n${essentialToolInfo}`,
                  },
                ],
              });
            }

            // Add a final instruction that's very explicit about using the tool results
            cleanedMessages.push({
              role: "user",
              parts: [
                {
                  text: "You MUST base your response on the tool results provided above. Treat the tool output as the definitive answer and incorporate it directly into your response without contradicting it. If a tool returns information about your mood, personality, or capabilities, you MUST adopt those characteristics in your response. Never say you don't have feelings or can't do something if a tool indicates otherwise.",
                },
              ],
            });

            // Make follow-up request
            const followupResponse = await model.generateContent({
              contents: cleanedMessages,
              generationConfig: {
                temperature: 0.1, // Lower temperature for more faithful adherence to instructions
              },
            });

            const followupText = followupResponse.response.text();
            console.log("Follow-up response:", followupText);

            // Replace or update the assistant's message with the comprehensive response
            if (followupText) {
              setMessages((prev) => {
                // Check if we already had an assistant message
                if (assistantMessageAdded && prev.length > 0) {
                  const lastMessageIndex = prev.length - 1;
                  if (prev[lastMessageIndex].role === "assistant") {
                    // Keep the tool responses at the end as collapsible details
                    const toolResponses =
                      prev[lastMessageIndex].content.match(
                        /<details>[\s\S]*?<\/details>/g,
                      ) || [];

                    const updated = [...prev];
                    updated[lastMessageIndex] = {
                      role: "assistant",
                      content: followupText + "\n\n" + toolResponses.join("\n"),
                    };
                    return updated;
                  }
                }

                // If no existing message to update, add a new one
                return [...prev, { role: "assistant", content: followupText }];
              });
            }
          } catch (followupError) {
            console.error(
              "Error generating follow-up response:",
              followupError,
            );
            setDebugInfo(
              (prev) =>
                prev + "\nError generating follow-up: " + String(followupError),
            );
          }
        }

        // If no response was generated at all, show an error
        if (!assistantMessageAdded && functionCalls.length === 0) {
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content:
                "I'm sorry, I wasn't able to generate a response. This might be due to an issue with the AI model or the tool configuration.",
            },
          ]);
        }
      }
    } catch (error) {
      // Handle potential errors during AI generation or streaming
      console.error("Error generating text:", error);
      setDebugInfo((prev) => prev + "\nError: " + String(error));

      const errorMessage: Message = {
        role: "assistant",
        content: `Error generating response: ${error instanceof Error ? error.message : String(error)}`,
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      // Hide loading indicator
      setIsLoading(false);
    }
  };

  // Determine connection status text
  const connectionStatusText = (() => {
    switch (connectionStatus) {
      case "connected":
        return "Connected";
      case "error":
        return "Connection Error";
      case "error-connecting-to-proxy":
        return "Proxy Connection Error";
      default:
        return "Disconnected";
    }
  })();

  return (
    <>
      {/* Add the custom styles */}
      {!apiKey && !import.meta.env.VITE_GOOGLE_GENERATIVE_AI_API_KEY && (
        <style dangerouslySetInnerHTML={{ __html: keyframeStyle }} />
      )}

      {/* TabsContent with Flex layout */}
      <TabsContent value="chat" className="mt-4 flex flex-col">
        {" "}
        {/* Adjust height as needed */}
        <div className="flex flex-1 gap-4 overflow-hidden">
          {" "}
          {/* Main flex container */}
          {/* Left Column: Configuration */}
          <div className="w-[300px] flex-shrink-0 space-y-3 overflow-y-auto p-1 flex flex-col h-full">
            {/* Connection status */}
            <div>
              <h4 className="text-sm font-medium mb-2">Connection Status</h4>
              <div className="bg-card rounded-md border p-2">
                <div className="flex items-center">
                  <div
                    className={`w-2 h-2 rounded-full mr-2 ${connectionStatus === "connected" ? "bg-green-500" : "bg-red-500"}`}
                  ></div>
                  <span className="text-xs text-muted-foreground">
                    MCP: {connectionStatusText}{" "}
                    {connectionStatus === "connected" && tools.length > 0
                      ? ` - ${tools.length} tools available`
                      : connectionStatus === "connected"
                        ? " - No tools found"
                        : ""}
                  </span>
                </div>
              </div>
            </div>

            {/* API Key Management */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-medium">API Key</h4>
                <div className="flex items-center gap-1">
                  {apiKey && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={() => setShowApiKey(!showApiKey)}
                      >
                        {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-destructive"
                        onClick={handleRemoveApiKey}
                      >
                        ✕
                      </Button>
                    </>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setApiKeyInputVisible(!apiKeyInputVisible)}
                    className={
                      !apiKey &&
                      !import.meta.env.VITE_GOOGLE_GENERATIVE_AI_API_KEY
                        ? "animated-border"
                        : ""
                    }
                  >
                    {!apiKey &&
                      !import.meta.env.VITE_GOOGLE_GENERATIVE_AI_API_KEY && (
                        <AlertCircle
                          size={14}
                          className="mr-1 animate-pulse text-primary"
                        />
                      )}
                    {apiKey ? "Change" : "Set API Key"}
                  </Button>
                </div>
              </div>
              <div className="bg-card rounded-md border p-2">
                <div className="flex items-center">
                  <div
                    className={`w-2 h-2 rounded-full mr-2 ${apiKey || import.meta.env.VITE_GOOGLE_GENERATIVE_AI_API_KEY ? "bg-green-500" : "bg-red-500"}`}
                  ></div>
                  <span className="text-xs text-muted-foreground flex-grow">
                    {apiKey
                      ? (showApiKey ? apiKey : getMaskedApiKey(apiKey)) +
                        " (custom)"
                      : import.meta.env.VITE_GOOGLE_GENERATIVE_AI_API_KEY
                        ? "Using environment key"
                        : "Missing"}
                  </span>
                </div>

                {apiKeyInputVisible && (
                  <div className="mt-1">
                    <p className="text-xs mb-1 text-muted-foreground">
                      Your API key is stored only in your browser's local
                      storage.
                    </p>
                    <div className="flex items-center gap-1">
                      <Key size={14} className="text-muted-foreground" />
                      <Input
                        type={showApiKey ? "text" : "password"}
                        placeholder="Enter Gemini API key"
                        value={apiKeyInputValue}
                        onChange={(e) => setApiKeyInputValue(e.target.value)}
                        className="flex-1 h-8 text-xs"
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="off"
                        spellCheck="false"
                      />
                      <Button
                        size="sm"
                        onClick={handleSaveApiKey}
                        disabled={!apiKeyInputValue.trim()}
                        className="h-8"
                      >
                        Save
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setApiKeyInputVisible(false)}
                        className="h-8"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Model Selection */}
            <div>
              <h4 className="text-sm font-medium mb-2">Model</h4>
              <div className="bg-card rounded-md border p-2 space-y-2">
                <div className="flex items-center">
                  <div
                    className={`w-2 h-2 rounded-full mr-2 bg-green-500`}
                  ></div>
                  <Select
                    value={useCustomModel ? "__custom__" : selectedModel}
                    onValueChange={handleModelChange}
                  >
                    <SelectTrigger className="h-7 text-xs flex-grow min-w-0">
                      <SelectValue placeholder="Select a model" />
                    </SelectTrigger>
                    <SelectContent>
                      {GEMINI_MODELS.map((model) => (
                        <SelectItem
                          key={model.id}
                          value={model.id}
                          className="text-xs"
                        >
                          <div>
                            <div>{model.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {model.description}
                            </div>
                          </div>
                        </SelectItem>
                      ))}
                      <SelectItem value="__custom__" className="text-xs">
                        <div>
                          <div>Custom Model</div>
                          <div className="text-xs text-muted-foreground">
                            Enter a custom model name
                          </div>
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {useCustomModel && (
                  <div className="mt-2">
                    <Input
                      type="text"
                      placeholder="e.g., gemini-1.5-pro-latest"
                      value={customModelInput}
                      onChange={(e) => handleCustomModelChange(e.target.value)}
                      className="h-7 text-xs"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Enter any valid Gemini model name
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Available Tools Selection */}
            {connectionStatus === "connected" &&
              toolsLoaded &&
              tools.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2">Available Tools</h4>
                  <ScrollArea className="h-32 w-full rounded-md border p-2 bg-card">
                    <div className="space-y-2">
                      {tools.map((tool) => (
                        <div
                          key={tool.name}
                          className="flex items-center justify-between"
                        >
                          <div className="flex items-center space-x-2">
                            <Checkbox
                              id={`tool-${tool.name}`}
                              checked={selectedTools[tool.name] || false}
                              onCheckedChange={(checked) => {
                                setSelectedTools((prev) => ({
                                  ...prev,
                                  [tool.name]: !!checked,
                                }));
                              }}
                            />
                            <label
                              htmlFor={`tool-${tool.name}`}
                              className="text-xs font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                            >
                              {tool.name}
                            </label>
                          </div>
                          <Dialog>
                            <DialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0"
                                onClick={() => setPreviewTool(tool)}
                              >
                                <Info size={14} />
                              </Button>
                            </DialogTrigger>
                          </Dialog>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              )}

            {/* Debug Info (only visible when there is debug content) */}
            {debugInfo && (
              <div className="flex-shrink-0">
                <h4 className="text-sm font-medium mb-2">Debug Info</h4>
                <div className="bg-card rounded-md border p-2">
                  <details>
                    <summary className="cursor-pointer text-xs font-medium">
                      Expand
                    </summary>
                    <ScrollArea className="h-32 mt-1">
                      <pre className="text-xs whitespace-pre-wrap">
                        {debugInfo}
                      </pre>
                    </ScrollArea>
                  </details>
                </div>
              </div>
            )}
          </div>{" "}
          {/* End Left Column */}
          {/* Tool Preview Dialog (Rendered once, outside the map) */}
          <Dialog
            open={!!previewTool}
            onOpenChange={(isOpen) => !isOpen && setPreviewTool(null)}
          >
            <DialogContent className="sm:max-w-[600px]">
              {previewTool && (
                <>
                  <DialogHeader>
                    <DialogTitle>{previewTool.name}</DialogTitle>
                    <DialogDescription>
                      {previewTool.description || "No description provided."}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="py-4">
                    <h5 className="text-sm font-semibold mb-2">Parameters:</h5>
                    {Object.keys(previewTool.parameters.properties).length >
                    0 ? (
                      <ScrollArea className="h-[200px] w-full rounded-md border p-3 bg-muted/50">
                        <pre className="text-xs whitespace-pre-wrap">
                          {JSON.stringify(previewTool.parameters, null, 2)}
                        </pre>
                      </ScrollArea>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        This tool takes no parameters.
                      </p>
                    )}
                  </div>
                </>
              )}
            </DialogContent>
          </Dialog>
          {/* Right Column: Chat Interface */}
          <div className="flex-1 flex flex-col h-full overflow-hidden">
            {/* Chat container: Use flex-1 to fill height */}
            <div className="flex flex-col border rounded overflow-hidden max-h-[500px]">
              {" "}
              {/* Set max height here */}
              {/* Message display area: grow and scroll */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {messages.length === 0 ? (
                  // Initial message if chat history is empty
                  <Alert className="bg-background">
                    <AlertTitle>Chat Ready</AlertTitle>
                    <AlertDescription>
                      Send a message using the input below to start chatting
                      with the AI.
                      {connectionStatus === "connected"
                        ? tools.length > 0
                          ? ` Select tools above. Currently available: ${tools.map((t) => t.name).join(", ")}` // Updated message
                          : " MCP connected but no tools available."
                        : " MCP not connected - using Gemini only."}
                    </AlertDescription>
                  </Alert>
                ) : (
                  // Render message history
                  messages.map((msg, index) => (
                    <div
                      key={index}
                      className={`flex w-full ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`p-3 rounded-lg max-w-[85%] ${
                          msg.role === "user"
                            ? "bg-primary text-primary-foreground" // User message style
                            : "bg-muted text-muted-foreground" // AI message style
                        }`}
                      >
                        {/* Use <pre> for better formatting of potential code/markdown */}
                        {/* Ensure content is a string before rendering, provide fallback */}
                        <pre
                          className="text-sm whitespace-pre-wrap font-sans text-left"
                          dangerouslySetInnerHTML={{
                            __html:
                              typeof msg.content === "string"
                                ? msg.content
                                : String(msg.content), // Ensure it's always a string
                          }}
                        />
                      </div>
                    </div>
                  ))
                )}
                {/* Loading indicator */}
                {isLoading && (
                  <div className="flex justify-center items-center p-3 text-muted-foreground">
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    AI is thinking...
                  </div>
                )}
                {/* Empty div at the end of messages to scroll to */}
                <div ref={messagesEndRef} />
              </div>
              {/* Input form area: Prevent shrinking */}
              <form
                onSubmit={handleSubmit}
                className="flex-shrink-0 p-4 border-t flex items-center gap-2 bg-background"
              >
                <Input
                  type="text"
                  placeholder="Send a message..."
                  value={input}
                  onChange={handleInputChange}
                  className="flex-1"
                  disabled={isLoading} // Disable input while loading
                  aria-label="Chat input"
                />
                <Button type="submit" disabled={isLoading || !input.trim()}>
                  {isLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    "Send"
                  )}
                </Button>
              </form>
            </div>{" "}
            {/* End Chat container */}
          </div>{" "}
          {/* End Right Column */}
        </div>{" "}
        {/* End Main flex container */}
      </TabsContent>
    </>
  );
};

export default ChatTab;
