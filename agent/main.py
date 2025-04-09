import os
from typing import Dict, List, Tuple, Any
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
import json
import asyncio
from pydantic import BaseModel
from langchain_openai import ChatOpenAI
from langgraph.graph import Graph, StateGraph
from langchain.prompts import ChatPromptTemplate
from langchain_core.messages import HumanMessage, AIMessage

# Load environment variables
load_dotenv()

app = FastAPI()

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, replace with your frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize LLM
llm = ChatOpenAI(
    model="gpt-3.5-turbo",
    temperature=0,
    streaming=True
)

class ChatState(BaseModel):
    messages: List[Dict[str, str]]
    current_tool: str = ""
    tool_input: Dict[str, Any] = {}
    tool_output: str = ""

def create_agent_graph() -> Graph:
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
    
    def should_use_tool(state: ChatState) -> bool:
        # Logic to determine if we should use a tool based on the last message
        last_message = state.messages[-1]["content"].lower()
        tool_keywords = {
            "mood": ["mood", "feeling", "how are you"],
            "fetch": ["get", "fetch", "download"],
        }
        
        for tool, keywords in tool_keywords.items():
            if any(keyword in last_message for keyword in keywords):
                state.current_tool = tool
                return True
        return False
    
    def format_tool_input(state: ChatState) -> ChatState:
        last_message = state.messages[-1]["content"]
        
        if state.current_tool == "mood":
            state.tool_input = {
                "tool": "mood",
                "params": {"question": last_message}
            }
        elif state.current_tool == "fetch":
            # Extract URL from message (simplified)
            state.tool_input = {
                "tool": "fetch",
                "params": {"url": last_message}
            }
            
        return state
    
    def generate_response(state: ChatState) -> ChatState:
        messages = [
            HumanMessage(content=state.messages[-1]["content"])
        ]
        
        if state.tool_output:
            messages.append(AIMessage(content=f"Tool result: {state.tool_output}"))
        
        response = llm.invoke(messages)
        state.messages.append({"role": "assistant", "content": response.content})
        return state
    
    # Define the workflow
    workflow.add_node("should_use_tool", should_use_tool)
    workflow.add_node("format_tool_input", format_tool_input)
    workflow.add_node("generate_response", generate_response)
    
    # Add edges with conditional routing
    workflow.add_conditional_edges(
        "should_use_tool",
        lambda x: x,
        {
            True: "format_tool_input",
            False: "generate_response"
        }
    )
    workflow.add_edge("format_tool_input", "generate_response")
    
    workflow.set_entry_point("should_use_tool")
    workflow.set_finish_point("generate_response")
    
    return workflow.compile()

# Create the agent graph
agent_graph = create_agent_graph()

@app.websocket("/chat")
async def chat_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("New WebSocket connection accepted")
    
    state = ChatState(messages=[])
    
    try:
        while True:
            # Receive message from client with timeout
            try:
                print("Waiting for client message...")
                data = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
                message = json.loads(data)
                print(f"Received message: {message}")
                
                # Add message to state
                state.messages.append({"role": "user", "content": message["content"]})
                
                # Run the agent
                print("Running agent...")
                new_state = agent_graph.invoke(state)
                print("Agent run completed")
                
                # If tool input is prepared, send it to client
                if new_state.tool_input:
                    print(f"Calling tool: {new_state.tool_input}")
                    await websocket.send_json({
                        "type": "tool_call",
                        "data": new_state.tool_input
                    })
                    
                    # Wait for tool result with timeout
                    print("Waiting for tool result...")
                    tool_result = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
                    print(f"Tool result received: {tool_result}")
                    new_state.tool_output = tool_result
                
                # Send final response
                print("Sending response...")
                await websocket.send_json({
                    "type": "message",
                    "data": new_state.messages[-1]
                })
                print("Response sent")
                
                # Update state
                state = new_state
                
            except asyncio.TimeoutError:
                print("Timeout waiting for client")
                await websocket.send_json({
                    "type": "error",
                    "data": {"message": "Request timed out"}
                })
                continue
            
    except Exception as e:
        print(f"Error in WebSocket handler: {e}")
        try:
            await websocket.send_json({
                "type": "error",
                "data": {"message": str(e)}
            })
        except:
            pass
        await websocket.close()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3001) 