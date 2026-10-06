import http.server
import socketserver
port = 8282
ip='172.30.64.1'
Handler = http.server.SimpleHTTPRequestHandler
server = socketserver.TCPServer((ip , port),Handler)
def run():
    print('serving at port ' , port )
    server.serve_forever()
run()
"""
import http.server
import socketserver
Handler = http.server.SimpleHTTPRequestHandler
server = socketserver.TCPServer(("192.168.1.2" , 7777) , Handler)
server.serve_forever()
"""