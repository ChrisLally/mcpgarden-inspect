from typing import Dict, List, Any, Tuple
from pydantic import BaseModel
from langchain_google_genai import ChatGoogleGenerativeAI
from langgraph.graph import Graph, StateGraph
from langchain.prompts import ChatPromptTemplate
from langchain_core.messages import HumanMessage, AIMessage

class ChatState(BaseModel):
    messages: List[Dict[str, str]]
    current_tool: str = ""
    tool_input: Dict[str, Any] = {}
    tool_output: str = ""

def create_agent() -> Graph:
    # Initialize LLM
    llm = ChatGoogleGenerativeAI(
        model="gemini-pro",
        temperature=0,
        streaming=True,
        convert_system_message_to_human=True
    )
    
    workflow = StateGraph(ChatState)
    
    # Define the agent prompt
    prompt = ChatPromptTemplate.from_messages([
        ("system", """You are an AI assistant integrated with an MCP (Model Context Protocol) server. 
        You can use various tools provided by the server to help users.
        
        Available tools:
        - mood: Ask about the server's mood
        - fetch: Fetch content from a URL
        - other tools will be discovered dynamically
        
        When a user asks a question:
        1. Determine if you need to use a tool
        2. If yes, specify the tool and its parameters
        3. If no, provide a direct response
        
        Format your tool calls as JSON:
        {"tool": "tool_name", "params": {"param1": "value1"}}
        """),
        ("human", "{input}"),
        ("ai", "{agent_scratchpad}"),
    ])
    
    def should_use_tool(state: ChatState) -> Dict[str, Any]:
        # Check if messages list exists and has items
        if not state.messages or len(state.messages) == 0:
            return {"use_tool": False, "tool": ""}
            
        # Safely get the last message
        try:
            last_message = state.messages[-1].get("content", "").lower()
        except (AttributeError, IndexError):
            return {"use_tool": False, "tool": ""}
            
        tool_keywords = {
            "mood": ["mood", "feeling", "how are you"],
            "fetch": ["get", "fetch", "download"],
        }
        
        for tool, keywords in tool_keywords.items():
            if any(keyword in last_message for keyword in keywords):
                state.current_tool = tool
                return {"use_tool": True, "tool": tool}
        return {"use_tool": False, "tool": ""}
    
    def format_tool_input(state: ChatState) -> ChatState:
        # Check if messages list exists and has items
        if not state.messages or len(state.messages) == 0:
            return state
            
        # Safely get the last message
        try:
            last_message = state.messages[-1].get("content", "")
        except (AttributeError, IndexError):
            return state
        
        if state.current_tool == "mood":
            state.tool_input = {
                "tool": "mood",
                "params": {"question": last_message}
            }
        elif state.current_tool == "fetch":
            state.tool_input = {
                "tool": "fetch",
                "params": {"url": last_message}
            }
            
        return state
    
    def generate_response(state: ChatState) -> ChatState:
        # Check if messages list exists and has items
        if not state.messages or len(state.messages) == 0:
            return state
            
        # Safely get the last message
        try:
            last_message = state.messages[-1].get("content", "")
        except (AttributeError, IndexError):
            return state
            
        # Format the input using the prompt template
        formatted_prompt = prompt.format(
            input=last_message,
            agent_scratchpad=""  # Empty for now since we're not using tools
        )
        
        # Convert formatted prompt messages to LangChain message types
        messages = []
        for msg in formatted_prompt.messages:
            if msg.type == "system":
                # Convert system message to human message for Gemini
                messages.append(HumanMessage(content=msg.content))
            elif msg.type == "human":
                messages.append(HumanMessage(content=msg.content))
            elif msg.type == "ai":
                messages.append(AIMessage(content=msg.content))
        
        # Add tool output if any
        if state.tool_output:
            messages.append(AIMessage(content=f"Tool result: {state.tool_output}"))
        
        try:
            # Get response from LLM
            response = llm.invoke(messages)
            
            # Add response to state
            if isinstance(response.content, str):
                state.messages.append({"role": "assistant", "content": response.content})
            else:
                state.messages.append({"role": "assistant", "content": str(response.content)})
        except Exception as e:
            print(f"Error calling LLM: {e}")
            state.messages.append({"role": "assistant", "content": "I encountered an error processing your request."})
            
        return state
    
    # Define the workflow
    workflow.add_node("should_use_tool", should_use_tool)
    workflow.add_node("format_tool_input", format_tool_input)
    workflow.add_node("generate_response", generate_response)
    
    # Add edges with conditional routing
    workflow.add_conditional_edges(
        "should_use_tool",
        lambda x: x["use_tool"],  # Access the dictionary key
        {
            True: "format_tool_input",
            False: "generate_response"
        }
    )
    workflow.add_edge("format_tool_input", "generate_response")
    
    workflow.set_entry_point("should_use_tool")
    workflow.set_finish_point("generate_response")
    
    return workflow.compile() 