from typing import Dict, List, Any, Optional
from pydantic import BaseModel, Field
from langchain_google_genai import ChatGoogleGenerativeAI
from langgraph.graph import Graph, StateGraph
from langchain.prompts import ChatPromptTemplate
from langchain_core.messages import HumanMessage, AIMessage
import os

class Message(BaseModel):
    role: str
    content: str

class ChatState(BaseModel):
    messages: List[Message] = Field(default_factory=list)
    current_tool: str = ""
    tool_input: Dict[str, Any] = Field(default_factory=dict)
    tool_output: str = ""

    def get_last_message(self) -> Optional[Message]:
        """Helper method to safely get the last message"""
        if not self.messages:
            return None
        return self.messages[-1]

def create_agent() -> Graph:
    # Check for API key
    if not os.getenv("GOOGLE_API_KEY"):
        raise ValueError("GOOGLE_API_KEY environment variable is not set")

    try:
        # Initialize LLM with debug mode
        llm = ChatGoogleGenerativeAI(
            model="gemini-2.0-flash",  # Updated to use the flash model
            temperature=0.7,  # Adding some temperature for more natural responses
            streaming=False,  # Disable streaming for now
            convert_system_message_to_human=True,
            verbose=True,
            max_tokens=1024  # Set a reasonable max token limit
        )
        
        # Test the LLM with a simple message to verify it works
        test_response = llm.invoke([HumanMessage(content="Hi")])
        print(f"LLM test response: {test_response.content}")
        
    except Exception as e:
        print(f"Error initializing LLM: {e}")
        raise ValueError(f"Failed to initialize Gemini model: {str(e)}")
    
    workflow = StateGraph(ChatState)
    
    # Define the agent prompt
    prompt = ChatPromptTemplate.from_messages([
        ("human", "{input}"),  # Start with just the input for simplicity
    ])
    
    def should_use_tool(state: ChatState) -> Dict[str, Any]:
        print("Entering should_use_tool...")  # Debug log
        
        last_message = state.get_last_message()
        if not last_message:
            print("No last message found")  # Debug log
            return {"use_tool": False, "tool": ""}
            
        message_content = last_message.content.lower()
        print(f"Processing message: {message_content}")  # Debug log
        
        tool_keywords = {
            "mood": ["mood", "feeling", "how are you"],
            "fetch": ["get", "fetch", "download"],
        }
        
        for tool, keywords in tool_keywords.items():
            if any(keyword in message_content for keyword in keywords):
                state.current_tool = tool
                print(f"Tool selected: {tool}")  # Debug log
                return {"use_tool": True, "tool": tool}
                
        print("No tool needed")  # Debug log
        return {"use_tool": False, "tool": ""}
    
    def format_tool_input(state: ChatState) -> ChatState:
        print("Entering format_tool_input...")  # Debug log
        
        last_message = state.get_last_message()
        if not last_message:
            return state
            
        message_content = last_message.content
        print(f"Formatting tool input for: {state.current_tool}")  # Debug log
        
        if state.current_tool == "mood":
            state.tool_input = {
                "tool": "mood",
                "params": {"question": message_content}
            }
        elif state.current_tool == "fetch":
            state.tool_input = {
                "tool": "fetch",
                "params": {"url": message_content}
            }
            
        return state
    
    def generate_response(state: ChatState) -> ChatState:
        print("Entering generate_response...")  # Debug log
        
        last_message = state.get_last_message()
        if not last_message:
            print("No message to respond to")  # Debug log
            return state
            
        try:
            # Format the input using the prompt template
            formatted_prompt = prompt.format(
                input=last_message.content
            )
            
            print("Sending to LLM:", formatted_prompt)  # Debug log
            
            # Convert to LangChain message types
            messages = [HumanMessage(content=last_message.content)]
            
            # Add tool output if any
            if state.tool_output:
                messages.append(AIMessage(content=f"Tool result: {state.tool_output}"))
            
            # Get response from LLM
            response = llm.invoke(messages)
            print(f"LLM Response: {response.content}")  # Debug log
            
            # Add response to state
            state.messages.append(Message(
                role="assistant",
                content=str(response.content)
            ))
            
        except Exception as e:
            print(f"Error in generate_response: {str(e)}")  # Debug log
            state.messages.append(Message(
                role="assistant",
                content="I encountered an error processing your request."
            ))
            
        return state
    
    # Define the workflow
    workflow.add_node("should_use_tool", should_use_tool)
    workflow.add_node("format_tool_input", format_tool_input)
    workflow.add_node("generate_response", generate_response)
    
    # Add edges with conditional routing
    workflow.add_conditional_edges(
        "should_use_tool",
        lambda x: x["use_tool"] if isinstance(x, dict) else False,  # Handle both dict and ChatState
        {
            True: "format_tool_input",
            False: "generate_response"
        }
    )
    workflow.add_edge("format_tool_input", "generate_response")
    
    workflow.set_entry_point("should_use_tool")
    workflow.set_finish_point("generate_response")
    
    print("Agent workflow compiled successfully")  # Debug log
    return workflow.compile() 