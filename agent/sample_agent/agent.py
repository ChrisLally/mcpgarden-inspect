from typing import Dict, List, Any, Optional, TypedDict
from pydantic import BaseModel, Field
from langchain_google_genai import ChatGoogleGenerativeAI
from langgraph.graph import Graph, StateGraph
from langchain.prompts import ChatPromptTemplate
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
import os

class MCPTool(TypedDict):
    name: str
    description: str
    input_schema: Dict[str, Any]

class Message(BaseModel):
    role: str
    content: str

class ChatState(BaseModel):
    messages: List[Message] = Field(default_factory=list)
    current_tool: str = ""
    tool_input: Dict[str, Any] = Field(default_factory=dict)
    tool_output: str = ""
    available_tools: Dict[str, MCPTool] = Field(default_factory=dict)

    def get_last_message(self) -> Optional[Message]:
        """Helper method to safely get the last message"""
        if not self.messages:
            return None
        return self.messages[-1]

def create_agent() -> Graph:
    if not os.getenv("GOOGLE_API_KEY"):
        raise ValueError("GOOGLE_API_KEY environment variable is not set")

    try:
        llm = ChatGoogleGenerativeAI(
            model="gemini-2.0-flash",
            temperature=0.7,
            streaming=False,
            convert_system_message_to_human=True,
            verbose=True,
            max_tokens=1024
        )
    except Exception as e:
        print(f"Error initializing LLM: {e}")
        raise ValueError(f"Failed to initialize Gemini model: {str(e)}")
    
    workflow = StateGraph(ChatState)
    
    def get_system_prompt(tools: Dict[str, MCPTool]) -> str:
        tool_descriptions = "\n".join([
            f"- {name}: {tool['description']}" 
            for name, tool in tools.items()
        ])
        return f"""You are a direct action agent that uses MCP tools. NEVER ask questions or request more information - just use the tools immediately.

Available tools:
{tool_descriptions}

IMPORTANT RULES:
1. When user mentions a tool, use it IMMEDIATELY without asking questions
2. NEVER ask for more information or clarification
3. NEVER explain what you're going to do
4. Just output the tool call in this format: {{"tool": "tool_name", "params": {{"param1": "value1"}}}}
5. If you can't use a tool, just say "Error: Unable to use tool" and nothing else"""

    prompt = ChatPromptTemplate.from_messages([
        ("system", "{system_message}"),
        ("human", "{input}")
    ])
    
    def should_use_tool(state: ChatState) -> Dict[str, Any]:
        print("Entering should_use_tool...")
        print(f"Available tools: {list(state.available_tools.keys())}")
        
        last_message = state.get_last_message()
        if not last_message:
            return {"use_tool": False, "tool": ""}
            
        message_content = last_message.content.lower().strip()
        print(f"Processing message: {message_content}")
        
        # Direct "use tool X" pattern
        if message_content.startswith("use tool "):
            requested_tool = message_content[9:].strip()  # Remove "use tool " prefix
            print(f"Extracted tool name: {requested_tool}")
            # First try exact match
            if requested_tool in [t.lower() for t in state.available_tools.keys()]:
                tool_name = next(t for t in state.available_tools.keys() if t.lower() == requested_tool)
                state.current_tool = tool_name
                print(f"Tool selected (direct command): {tool_name}")
                return {"use_tool": True, "tool": tool_name}
        
        # Check other variations
        tool_intent_phrases = [
            "can you use tool",
            "could you use tool",
            "please use tool",
            "try tool",
            "run tool",
            "execute tool"
        ]
        
        for phrase in tool_intent_phrases:
            if message_content.startswith(phrase + " "):
                requested_tool = message_content[len(phrase) + 1:].strip()
                print(f"Extracted tool name from phrase '{phrase}': {requested_tool}")
                if requested_tool in [t.lower() for t in state.available_tools.keys()]:
                    tool_name = next(t for t in state.available_tools.keys() if t.lower() == requested_tool)
                    state.current_tool = tool_name
                    print(f"Tool selected (variation): {tool_name}")
                    return {"use_tool": True, "tool": tool_name}
        
        # Finally check for direct tool name
        message_tool = message_content.strip()
        if message_tool in [t.lower() for t in state.available_tools.keys()]:
            tool_name = next(t for t in state.available_tools.keys() if t.lower() == message_tool)
            state.current_tool = tool_name
            print(f"Tool selected (name only): {tool_name}")
            return {"use_tool": True, "tool": tool_name}
        
        print("No tool needed")
        return {"use_tool": False, "tool": ""}
    
    def format_tool_input(state: ChatState) -> ChatState:
        print("Entering format_tool_input...")
        
        last_message = state.get_last_message()
        if not last_message or not state.current_tool:
            return state
            
        message_content = last_message.content
        tool_info = state.available_tools.get(state.current_tool)
        if not tool_info:
            print(f"Tool {state.current_tool} not found in available tools")
            return state
            
        print(f"Formatting tool input for: {state.current_tool}")
        
        # Create tool input structure
        state.tool_input = {
            "tool": state.current_tool,
            "params": {}
        }
        
        # Extract parameters based on the tool's input schema
        if "input_schema" in tool_info:
            properties = tool_info["input_schema"].get("properties", {})
            # For now, use the first parameter as the main input
            # TODO: Add more sophisticated parameter extraction
            if properties:
                main_param = next(iter(properties.keys()))
                state.tool_input["params"][main_param] = message_content
        
        print(f"Tool input formatted: {state.tool_input}")
        return state
        
    def generate_response(state: ChatState) -> ChatState:
        print("Entering generate_response...")
        
        last_message = state.get_last_message()
        if not last_message:
            return state
            
        try:
            # If we have a tool to use, ALWAYS format it directly without using LLM
            if state.current_tool:
                tool_info = state.available_tools.get(state.current_tool)
                if tool_info:
                    # Create direct tool call
                    tool_call = {
                        "tool": state.current_tool,
                        "params": {}
                    }
                    
                    # Add first parameter if available
                    if "input_schema" in tool_info:
                        properties = tool_info["input_schema"].get("properties", {})
                        if properties:
                            main_param = next(iter(properties.keys()))
                            tool_call["params"][main_param] = ""  # Empty string as we don't need additional input
                    
                    print(f"Using tool directly: {tool_call}")
                    # Important: Add both the tool input and a message
                    state.tool_input = tool_call
                    state.messages.append(Message(
                        role="assistant",
                        content=str(tool_call)
                    ))
                    return state
            
            # For non-tool responses, keep it simple
            messages = [HumanMessage(content=last_message.content)]
            response = llm.invoke(messages)
            state.messages.append(Message(
                role="assistant",
                content=str(response.content)
            ))
            
        except Exception as e:
            print(f"Error in generate_response: {str(e)}")
            state.messages.append(Message(
                role="assistant",
                content="Error: Unable to process request"
            ))
            
        return state

    # Define workflow
    workflow.add_node("should_use_tool", should_use_tool)
    workflow.add_node("format_tool_input", format_tool_input)
    workflow.add_node("generate_response", generate_response)
    
    # Add edges with conditional routing
    workflow.add_conditional_edges(
        "should_use_tool",
        lambda x: x["use_tool"] if isinstance(x, dict) else False,
        {
            True: "format_tool_input",
            False: "generate_response"
        }
    )
    workflow.add_edge("format_tool_input", "generate_response")
    
    workflow.set_entry_point("should_use_tool")
    workflow.set_finish_point("generate_response")
    
    print("Agent workflow compiled successfully")
    return workflow.compile() 